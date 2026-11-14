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
  private pingTimer: number | null = null;
  state: PeerState = "idle";
  rttSamples: number[] = [];
  /** Round trip of the data channel in ms; 0 until the first pong. */
  rtt = 0;

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
      if (typeof ev.data !== "string") return;
      // Control frames are tiny JSON objects; gameplay frames are much larger
      // and start with their own header, so the prefix check is unambiguous.
      if (ev.data.length < 64 && ev.data.startsWith('{"k":"p')) {
        this.handleControl(ev.data);
        return;
      }
      this.handles.onMessage(ev.data);
    };
    ch.onopen = () => {
      this.setState("connected");
      this.startPing();
    };
    if (ch.readyState === "open") {
      this.startPing();
    }
  }

  private startPing() {
    if (this.pingTimer !== null) return;
    this.ping();
    this.pingTimer = window.setInterval(() => this.ping(), 1500);
  }

  private ping() {
    if (!this.channel || this.channel.readyState !== "open") return;
    try {
      this.channel.send(JSON.stringify({ k: "ping", t: Math.round(performance.now()) }));
    } catch {
      /* dropped control frame is harmless */
    }
  }

  private handleControl(raw: string) {
    let msg: { k?: string; t?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.k === "ping" && this.channel?.readyState === "open") {
      try {
        this.channel.send(JSON.stringify({ k: "pong", t: msg.t }));
      } catch {
        /* ignore */
      }
      return;
    }
    if (msg.k === "pong" && typeof msg.t === "number") {
      const sample = Math.max(0, Math.round(performance.now() - msg.t));
      this.rttSamples.push(sample);
      if (this.rttSamples.length > 12) this.rttSamples.shift();
      const sorted = [...this.rttSamples].sort((a, b) => a - b);
      this.rtt = sorted[Math.floor(sorted.length / 2)];
    }
  }

  /** Human label for the measured round trip. */
  quality(): "excellent" | "good" | "fair" | "poor" | "unknown" {
    if (!this.rtt) return "unknown";
    if (this.rtt < 60) return "excellent";
    if (this.rtt < 100) return "good";
    if (this.rtt < 150) return "fair";
    return "poor";
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
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
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
