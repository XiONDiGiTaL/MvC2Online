// Remote Play: the host runs the real game on their own PC and streams it to a
// viewer's browser over WebRTC, with the viewer's buttons coming back on the
// same connection. The game never leaves the host's machine and nothing is
// uploaded; the viewer needs no files, no install and no controller.
//
// Signaling reuses the same Realtime RealtimeSignal rooms as online play.

import { loadRealtimeConfig, RealtimeSignal } from "./signal-rt";
import type { RoomState, SignalMessage } from "./signal";

export type RemoteState = "idle" | "waiting" | "connecting" | "connected" | "failed";

export interface RemoteHooks {
  onState: (s: RemoteState, detail?: string) => void;
  onCode: (code: string) => void;
  onStream: (stream: MediaStream) => void;
  onInput: (e: { button: string; down: boolean }) => void;
  onError: (message: string) => void;
}

const ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export class RemoteSession {
  readonly isHost: boolean;
  code = "";
  private name: string;
  private hooks: RemoteHooks;
  private sig: RealtimeSignal | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private offered = false;
  private closed = false;

  constructor(isHost: boolean, name: string, hooks: RemoteHooks) {
    this.isHost = isHost;
    this.name = name || "Player";
    this.hooks = hooks;
  }

  /** Host: open a room and, once the viewer arrives, start sending the screen. */
  async host(stream: MediaStream): Promise<void> {
    this.stream = stream;
    await this.open();
    this.sig!.send({ t: "create", name: this.name });
  }

  /** Viewer: join the host's room and wait for the stream. */
  async join(code: string): Promise<void> {
    await this.open();
    const upper = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    this.sig!.send({ t: "join", code: upper, name: this.name });
  }

  private async open() {
    const cfg = await loadRealtimeConfig();
    if (!cfg) throw new Error("Remote Play needs the online service configured for this build.");
    const sig = new RealtimeSignal(cfg, this.name);
    this.sig = sig;
    sig.onMessage((m) => {
      void this.onSignal(m);
    });
    await sig.connect();
  }

  private async onSignal(m: SignalMessage) {
    if (this.closed) return;

    if (m.t === "created" && m.room) {
      this.code = m.room.code;
      this.hooks.onCode(m.room.code);
      this.hooks.onState("waiting");
      return;
    }

    if (m.t === "joined" && m.room) {
      this.code = m.room.code;
      this.hooks.onCode(m.room.code);
      this.hooks.onState("connecting", "Waiting for the host's stream…");
      return;
    }

    if (m.t === "room") {
      const room = m.room as RoomState;
      if (this.isHost && room.guest && this.stream && !this.offered) {
        this.offered = true;
        this.hooks.onState("connecting", "Viewer joined, starting the stream…");
        await this.sendStream();
      }
      return;
    }

    if (m.t === "error") {
      this.hooks.onError(m.message);
      return;
    }

    if (m.t !== "signal") return;
    const data = m.data as { kind?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    if (!data || typeof data.kind !== "string") return;

    if (this.isHost) {
      if (data.kind === "answer" && data.sdp && this.pc) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.kind === "ice" && data.candidate) {
        await this.addIce(data.candidate);
      }
      return;
    }

    // Viewer side.
    if (data.kind === "offer" && data.sdp) {
      await this.acceptOffer(data.sdp);
    } else if (data.kind === "ice" && data.candidate) {
      await this.addIce(data.candidate);
    }
  }

  private async addIce(candidate: RTCIceCandidateInit) {
    if (!this.pc) return;
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn("[remote] ice rejected", err);
    }
  }

  private newPeer() {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.sig?.send({ t: "signal", data: { kind: "ice", candidate: ev.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") this.hooks.onState("connected");
      else if (st === "failed") this.hooks.onState("failed", "The connection could not be established.");
      else if (st === "disconnected") this.hooks.onState("failed", "Connection lost.");
    };
    this.pc = pc;
    return pc;
  }

  private async sendStream() {
    const pc = this.newPeer();
    const stream = this.stream!;
    for (const track of stream.getVideoTracks()) pc.addTrack(track, stream);
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

    const dc = pc.createDataChannel("ctl", { ordered: true });
    this.bindChannel(dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sig?.send({ t: "signal", data: { kind: "offer", sdp: pc.localDescription } });
  }

  private async acceptOffer(sdp: RTCSessionDescriptionInit) {
    const pc = this.newPeer();
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.hooks.onStream(stream);
    };
    pc.ondatachannel = (ev) => this.bindChannel(ev.channel);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sig?.send({ t: "signal", data: { kind: "answer", sdp: pc.localDescription } });
  }

  private bindChannel(ch: RTCDataChannel) {
    this.dc = ch;
    ch.onopen = () => this.hooks.onState("connected");
    ch.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: { k?: string; button?: string; down?: boolean };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.k === "in" && msg.button) this.hooks.onInput({ button: msg.button, down: !!msg.down });
    };
  }

  /** Viewer -> host: one button transition. */
  sendInput(button: string, down: boolean) {
    if (this.dc && this.dc.readyState === "open") {
      try {
        this.dc.send(JSON.stringify({ k: "in", button, down }));
      } catch {
        /* dropped while the link is unstable */
      }
    }
  }

  get ready(): boolean {
    return this.dc?.readyState === "open";
  }

  close() {
    this.closed = true;
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.dc = null;
    this.pc = null;
    this.sig?.send({ t: "leave" });
    this.sig?.close();
    this.sig = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
