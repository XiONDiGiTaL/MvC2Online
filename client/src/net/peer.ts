// WebRTC data channel for gameplay traffic.
//
// Why WebRTC and not the signaling WebSocket: fighting games need an unreliable,
// unordered transport so a dropped input packet is never head-of-line blocked.
// Inputs go on an unordered channel with zero retransmits; the reliable
// WebSocket carries only room/membership state.

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export type PeerState =
  | "idle"
  | "connecting"
  | "connected"
  | "failed"
  | "closed";

export interface PeerHandles {
  onState: (s: PeerState, detail?: string) => void;
  onMessage: (data: string) => void;
}

export class RtcPeer {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private handles: PeerHandles;
  private initiator: boolean;
  private remoteId: string;
  private sendSignal: (data: unknown) => void;
  private iceQueue: RTCIceCandidateInit[] = [];
  private remoteSet = false;
  state: PeerState = "idle";
  rttSamples: number[] = [];

  constructor(initiator: boolean, remoteId: string, sendSignal: (data: unknown) => void, handles: PeerHandles) {
    this.initiator = initiator;
    this.remoteId = remoteId;
    this.sendSignal = sendSignal;
    this.handles = handles;
  }

  private setState(s: PeerState, detail?: string) {
    this.state = s;
    this.handles.onState(s, detail);
  }

  async start() {
    this.setState("connecting");
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.sendSignal({ kind: "ice", candidate: ev.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") this.setState("connected");
      else if (st === "failed") this.setState("failed", "ICE failed — a TURN relay may be required on this network.");
      else if (st === "disconnected") this.setState("failed", "Peer disconnected.");
      else if (st === "closed") this.setState("closed");
    };
    pc.ondatachannel = (ev) => this.bindChannel(ev.channel);

    if (this.initiator) {
      const ch = pc.createDataChannel("inputs", {
        ordered: false,
        maxRetransmits: 0,
      });
      this.bindChannel(ch);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal({ kind: "offer", sdp: pc.localDescription });
    }
  }

  private bindChannel(ch: RTCDataChannel) {
    this.channel = ch;
    ch.binaryType = "arraybuffer";
    ch.onopen = () => this.setState("connected");
    ch.onclose = () => this.setState("closed");
    ch.onmessage = (ev) => {
      if (typeof ev.data === "string") this.handles.onMessage(ev.data);
    };
  }

  async handleSignal(data: unknown) {
    const msg = data as { kind?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    if (!msg || typeof msg.kind !== "string") return;
    const pc = this.pc;
    if (!pc) return;
    if (msg.kind === "offer" && msg.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      this.remoteSet = true;
      await this.drainIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal({ kind: "answer", sdp: pc.localDescription });
    } else if (msg.kind === "answer" && msg.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      this.remoteSet = true;
      await this.drainIce();
    } else if (msg.kind === "ice" && msg.candidate) {
      if (this.remoteSet) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (err) {
          console.warn("[peer] addIceCandidate failed", err);
        }
      } else {
        this.iceQueue.push(msg.candidate);
      }
    }
  }

  private async drainIce() {
    const pc = this.pc;
    if (!pc) return;
    const q = this.iceQueue;
    this.iceQueue = [];
    for (const c of q) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn("[peer] queued candidate rejected", err);
      }
    }
  }

  /** The match screen takes over the message handler once gameplay starts. */
  setMessageHandler(fn: (data: string) => void) {
    this.handles.onMessage = fn;
  }

  get isOpen(): boolean {
    return this.channel !== null && this.channel.readyState === "open";
  }

  send(text: string) {
    if (this.channel && this.channel.readyState === "open") {
      try {
        this.channel.send(text);
      } catch {
        /* a dropped unreliable packet is fine */
      }
    }
  }

  bufferedAmount(): number {
    return this.channel?.bufferedAmount ?? 0;
  }

  close() {
    try {
      this.channel?.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.channel = null;
    this.pc = null;
    this.setState("closed");
  }
}
