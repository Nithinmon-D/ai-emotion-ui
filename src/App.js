import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
import WavEncoder from "wav-encoder";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";

const socket = io("http://192.168.0.216:3001");

function App() {
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [role, setRole] = useState("");
  const [remoteUserInfo, setRemoteUserInfo] = useState({ name: "", role: "" });
  const [emotionSummaries, setEmotionSummaries] = useState([]);
  const [selectedModel, setSelectedModel] = useState("modelA");
  const [finalModalResult, setFinalModalResult] = useState({});
  const [showFinalModal, setShowFinalModal] = useState(false);

  const localStreamRef = useRef(null);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const [remoteStream, setRemoteStream] = useState(new MediaStream());
  const initialized = useRef(false);

  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const audioDataRef = useRef([]);
  const videoDataRef = useRef([]);
  const canvasRef = useRef(null);
  const captureVideo = useRef(true);

  const summaryScrollRef = useRef(null);

  useEffect(() => {
    if (role === "doctor" && summaryScrollRef.current) {
      summaryScrollRef.current.scrollTop =
        summaryScrollRef.current.scrollHeight;
    }
  }, [emotionSummaries]);

  useEffect(() => {
    const onResult = (data) => {
      console.log("📊 Emotion Result from FastAPI:", data);
      const now = new Date().toISOString();

      // ✅ Final Summary — only for doctor
      if (
        (data.isFinalSummary === true || data.isFinalSummary === "true") &&
        role === "doctor"
      ) {
        setFinalModalResult({
          modelA: data.summary || "No data",
          modelB: data.summary_llama || "No data",
        });
        setShowFinalModal(true);

        // ✅ Delay cleanup so the modal has time to show
        setTimeout(() => {
          safeDisconnect(); // <-- clean up only after modal
        }, 1000);

        return;
      }

      // ✅ Chunked summary (normal flow)
      setEmotionSummaries((prev) => [
        ...prev,
        {
          timestamp: now,
          modelA: data.summary || null,
          modelB: data.summary_llama || null,
        },
      ]);
    };

    socket.on("analysis-result", onResult);

    return () => {
      socket.off("analysis-result", onResult);
    };
  }, [role]);

  useEffect(() => {
    if (!joined || initialized.current) return;
    initialized.current = true;

    const start = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;

      const audioContext = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      audioSourceRef.current = source;
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      audioProcessorRef.current = processor;

      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (e) => {
        const pcm = e.inputBuffer.getChannelData(0);
        audioDataRef.current.push(...pcm);
      };

      const videoEl = document.createElement("video");
      videoEl.srcObject = new MediaStream([stream.getVideoTracks()[0]]);
      await videoEl.play().catch(() => {});
      const canvas = document.createElement("canvas");
      canvasRef.current = canvas;
      const ctx = canvas.getContext("2d");

      const captureFrame = () => {
        if (!captureVideo.current) return;
        try {
          if (videoEl.videoWidth && videoEl.videoHeight) {
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            ctx.drawImage(videoEl, 0, 0);
            const imageData = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height
            );
            const rgba = imageData.data;
            const yuv = rgbaToYuv(rgba, canvas.width, canvas.height);
            videoDataRef.current.push(yuv);
          }
        } catch (err) {
          console.error("Frame capture error:", err.message);
        }
        requestAnimationFrame(captureFrame);
      };

      requestAnimationFrame(captureFrame);

      function uint8ToBase64(uint8Array) {
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        return btoa(binary);
      }

      setInterval(async () => {
        const timestamp = new Date().toISOString();

        let audio = null;
        if (audioDataRef.current.length > 0) {
          const float32 = new Float32Array(audioDataRef.current);
          const audioBuffer = {
            sampleRate: 44100, // or 16000 if required
            channelData: [float32],
          };

          try {
            const buffer = await WavEncoder.encode(audioBuffer);
            const uint8Array = new Uint8Array(buffer);
            audio = uint8ToBase64(uint8Array);
            audioDataRef.current = [];
          } catch (err) {
            console.error("Audio encoding failed:", err);
          }
        }

        let video = null;
        try {
          const canvas = document.createElement("canvas");
          const videoEl = localVideo.current;
          if (videoEl && videoEl.videoWidth && videoEl.videoHeight) {
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(videoEl, 0, 0);
            video = canvas.toDataURL("image/jpeg"); // already base64
          }
        } catch (err) {
          console.error("Video capture failed:", err);
        }

        socket.emit("media-data", {
          timestamp,
          audio,
          video,
        });
      }, 5000);

      const rtpCapabilities = await new Promise((res) =>
        socket.emit("getRtpCapabilities", res)
      );

      const device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      deviceRef.current = device;

      const sendParams = await new Promise((res) =>
        socket.emit("createWebRtcTransport", {}, res)
      );
      const sendTransport = device.createSendTransport(sendParams);
      sendTransportRef.current = sendTransport;

      sendTransport.on("connect", ({ dtlsParameters }, callback) => {
        socket.emit(
          "connectTransport",
          { transportId: sendTransport.id, dtlsParameters },
          callback
        );
      });

      sendTransport.on(
        "produce",
        async ({ kind, rtpParameters, appData }, callback) => {
          const { id } = await new Promise((res) =>
            socket.emit("produce", { kind, rtpParameters, appData }, res)
          );
          callback({ id });
        }
      );

      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];

      if (audioTrack) {
        await sendTransport.produce({
          track: audioTrack,
          appData: { mediaTag: `audio-${socket.id}` },
        });
      }

      if (videoTrack) {
        await sendTransport.produce({
          track: videoTrack,
          appData: { mediaTag: `video-${socket.id}` },
        });
      }

      const recvParams = await new Promise((res) =>
        socket.emit("createWebRtcTransport", {}, res)
      );
      const recvTransport = device.createRecvTransport(recvParams);
      recvTransportRef.current = recvTransport;

      recvTransport.on("connect", ({ dtlsParameters }, callback) => {
        socket.emit(
          "connectTransport",
          { transportId: recvTransport.id, dtlsParameters },
          callback
        );
      });

      socket.emit("getCurrentProducers", async (producerList) => {
        const recvTransport = recvTransportRef.current;

        if (!recvTransport || recvTransport.closed) return;

        for (const { producerId, name, role } of producerList) {
          const consumeParams = await new Promise((res) =>
            socket.emit(
              "consume",
              {
                rtpCapabilities: deviceRef.current.rtpCapabilities,
                producerId,
              },
              res
            )
          );

          const consumer = await recvTransport.consume({
            id: consumeParams.id,
            producerId: consumeParams.producerId,
            kind: consumeParams.kind,
            rtpParameters: consumeParams.rtpParameters,
          });

          remoteStream.addTrack(consumer.track);
          if (remoteVideo.current) {
            remoteVideo.current.srcObject = remoteStream;
          }

          // ✅ Add this to display doctor info to patient
          setRemoteUserInfo({ name, role });
        }
      });

      socket.on("newProducer", async ({ producerId, name, role }) => {
        console.log("newProducer", producerId, name, role);
        setRemoteUserInfo({ name, role });
        const recvTransport = recvTransportRef.current;

        if (!recvTransport || recvTransport.closed) {
          console.warn("⚠️ Tried to consume on closed transport. Skipping.");
          return;
        }

        const consumeParams = await new Promise((res) =>
          socket.emit(
            "consume",
            { rtpCapabilities: deviceRef.current.rtpCapabilities, producerId },
            res
          )
        );

        const consumer = await recvTransport.consume({
          id: consumeParams.id,
          producerId: consumeParams.producerId,
          kind: consumeParams.kind,
          rtpParameters: consumeParams.rtpParameters,
        });

        remoteStream.addTrack(consumer.track);
        if (remoteVideo.current) {
          remoteVideo.current.srcObject = remoteStream;
        }
      });
    };

    start();
  }, [joined]);

  useEffect(() => {
    socket.on("forceHangUp", ({ socketId }) => {
      console.log(`Other user (${socketId}) hung up. Disconnecting...`);
      hangUp();
      setJoined(false);
      initialized.current = false;
      setRole("");
    });

    return () => {
      socket.off("forceHangUp");
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      hangUp(); // cleanly disconnect on reload
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const rgbaToYuv = (rgba, width, height) => {
    const yuv = new Uint8Array(width * height * 1.5);
    let yIndex = 0,
      uIndex = width * height,
      vIndex = uIndex + (width * height) / 4;
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i],
        g = rgba[i + 1],
        b = rgba[i + 2];
      yuv[yIndex++] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (i % 8 === 0) {
        yuv[uIndex++] = -0.169 * r - 0.331 * g + 0.5 * b + 128;
        yuv[vIndex++] = 0.5 * r - 0.419 * g - 0.081 * b + 128;
      }
    }
    return yuv;
  };

  const toggleAudio = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsAudioMuted(!audioTrack.enabled);
    }
  };

  const toggleVideo = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoMuted(!videoTrack.enabled);
    }
  };

  const hangUp = () => {
    console.log("👋 Hanging up...", socket.connected);

    if (socket.connected) {
      socket.emit("hangUp");
    }
  };

  const safeDisconnect = () => {
    console.log("🧹 Safe disconnect triggered after final summary...");

    if (socket.connected) {
      socket.disconnect();
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (localVideo.current?.srcObject) {
      localVideo.current.srcObject.getTracks().forEach((track) => track.stop());
      localVideo.current.srcObject = null;
    }

    if (remoteVideo.current?.srcObject) {
      remoteVideo.current.srcObject
        .getTracks()
        .forEach((track) => track.stop());
      remoteVideo.current.srcObject = null;
    }

    if (sendTransportRef.current) {
      sendTransportRef.current.close();
      sendTransportRef.current = null;
    }

    if (recvTransportRef.current) {
      recvTransportRef.current.close();
      recvTransportRef.current = null;
    }

    deviceRef.current = null;
    setRemoteStream(new MediaStream());
    captureVideo.current = false;

    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }

    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    audioDataRef.current = [];
    videoDataRef.current = [];

    if (role === "patient") {
      setEmotionSummaries([]);
      setSelectedModel("modelA");
      setRole("");
      setRemoteUserInfo({ name: "", role: "" });
      setJoined(false);
    }

    initialized.current = false;
    console.log("✅ Safe disconnect done.");
  };

  const handleJoin = () => {
    if (socket.disconnected) {
      socket.connect(); // Ensure clean re-connect
    }
    socket.emit("joinMeeting", { name }, ({ assignedRole }) => {
      setRole(assignedRole);
      setJoined(true);
    });
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "Segoe UI, sans-serif",
        backgroundColor: "#f5f7fa",
        overflow: "hidden",
      }}
    >
      {!joined ? (
        <div
          style={{
            position: "relative",
            minHeight: "100vh",
            width: "100%",
            backgroundImage: "url('/background.png')",
            backgroundSize: "cover",
            backgroundPosition: "center center",
            backgroundRepeat: "no-repeat",
            backgroundAttachment: "fixed",
            fontFamily: "Segoe UI, sans-serif",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
            boxSizing: "border-box",
          }}
        >
          {/* Background Overlay */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: "100%",
              backgroundColor: "rgba(0, 0, 0, 0.35)",
              zIndex: 0,
            }}
          />

          {/* Center Card */}
          <div
            style={{
              position: "relative",
              backgroundColor: "rgba(255, 255, 255, 0.97)",
              borderRadius: 20,
              padding: "40px 30px",
              width: "100%",
              maxWidth: 420,
              boxShadow: "0 12px 28px rgba(0, 0, 0, 0.25)",
              textAlign: "center",
              zIndex: 1,
              animation: "fadeInUp 0.6s ease-out",
            }}
          >
            {/* Title */}
            <h1
              style={{
                marginBottom: 8,
                fontSize: 28,
                fontWeight: 700,
                color: "#1976d2",
                letterSpacing: "0.5px",
              }}
            >
              Emotional Analyzer
            </h1>

            {/* What is it */}
            <p style={{ fontSize: 14, margin: "8px 0 22px", color: "#555" }}>
              Real-time emotion tracking to enhance doctor-patient interaction
              and understanding.
            </p>

            {/* Name Input */}
            <input
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                padding: "12px 15px",
                width: "100%",
                fontSize: 16,
                border: "1px solid #ccc",
                borderRadius: 8,
                marginBottom: 20,
                boxSizing: "border-box",
              }}
            />

            {/* Join Button */}
            <button
              onClick={handleJoin}
              style={{
                padding: "12px 20px",
                fontSize: 16,
                fontWeight: 600,
                backgroundColor: "#1976d2",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                width: "100%",
                cursor: "pointer",
                transition: "background-color 0.3s",
              }}
              onMouseOver={(e) => (e.target.style.backgroundColor = "#1259a3")}
              onMouseOut={(e) => (e.target.style.backgroundColor = "#1976d2")}
            >
              Join Meeting
            </button>

            {/* Consent Note */}
            <p
              style={{
                marginTop: 24,
                fontSize: 12,
                color: "#888",
                lineHeight: 1.4,
              }}
            >
              By joining, you consent to emotion-based video analysis. All data
              is handled securely and is not stored without permission.
            </p>
          </div>

          {/* Animation Style */}
          <style>
            {`
      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `}
          </style>
        </div>
      ) : (
        <>
          {/* LEFT: Video Section */}
          <div
            style={{
              flex: 3,
              padding: 20,
              position: "relative",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h2 style={{ margin: 0 }}>Welcome, {name}</h2>
            </div>

            <div
              style={{
                position: "relative",
                flex: 1,
                marginTop: 10,
                borderRadius: 10,
                overflow: "hidden",
                backgroundColor: "#000",
              }}
            >
              {/* Remote video big */}
              <div
                style={{ position: "relative", width: "100%", height: "100%" }}
              >
                <video
                  ref={remoteVideo}
                  autoPlay
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 10,
                    left: 10,
                    backgroundColor: "rgba(0, 0, 0, 0.6)",
                    color: "#fff",
                    padding: "6px 12px",
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: "500",
                  }}
                >
                  {remoteUserInfo.name
                    ? `${remoteUserInfo.name} (${
                        remoteUserInfo.role === "patient" ? "Patient" : "Doctor"
                      })`
                    : "Remote Participant"}
                </div>
              </div>

              {/* Local video small */}
              <div
                style={{
                  position: "absolute",
                  bottom: 16,
                  right: 16,
                  width: "25%",
                  borderRadius: 8,
                  overflow: "hidden",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                  backgroundColor: "#000",
                  border: "2px solid #fff",
                }}
              >
                <video
                  ref={localVideo}
                  autoPlay
                  muted
                  style={{
                    width: "100%",
                    height: "auto",
                    display: "block",
                    objectFit: "cover",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: 6,
                    left: 6,
                    backgroundColor: "rgba(0, 0, 0, 0.6)",
                    color: "#fff",
                    padding: "4px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: "500",
                  }}
                >
                  You
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 20,
                alignSelf: "center",
                display: "flex",
                justifyContent: "center",
                gap: 16,
              }}
            >
              {/* Audio Toggle */}
              <button
                onClick={toggleAudio}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  fontSize: 15,
                  backgroundColor: isAudioMuted ? "#43a047" : "#e53935",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                }}
              >
                {isAudioMuted ? <Mic size={18} /> : <MicOff size={18} />}
                {isAudioMuted ? "Unmute Audio" : "Mute Audio"}
              </button>

              {/* Video Toggle */}
              <button
                onClick={toggleVideo}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  fontSize: 15,
                  backgroundColor: isVideoMuted ? "#43a047" : "#e53935",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                }}
              >
                {isVideoMuted ? <Video size={18} /> : <VideoOff size={18} />}
                {isVideoMuted ? "Resume Video" : "Pause Video"}
              </button>

              {/* Hang Up */}
              <button
                onClick={hangUp}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  fontSize: 15,
                  backgroundColor: "#616161",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                }}
              >
                <PhoneOff size={18} />
                Hang Up
              </button>
            </div>
          </div>

          {/* RIGHT: Emotion Summary or Info for Patient */}
          <div
            style={{
              flex: 2,
              height: "calc(100vh - 40px)",
              margin: 20,
              padding: "20px",
              backgroundColor: "#e3f2fd",
              border: "1px solid #90caf9",
              boxSizing: "border-box",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Sticky Header */}
            <div
              style={{
                position: "sticky",
                top: 0,
                backgroundColor: "#e3f2fd",
                zIndex: 10,
                paddingBottom: 10,
              }}
            >
              <h3 style={{ marginTop: 0 }}>
                {role === "doctor"
                  ? "🧠 Emotional Analysis Summary"
                  : "📝 Meeting Guidelines"}
              </h3>

              {role === "doctor" && (
                <div style={{ marginBottom: 16, display: "flex", gap: 10 }}>
                  <button
                    onClick={() => setSelectedModel("modelA")}
                    style={{
                      flex: 1,
                      padding: "10px",
                      fontWeight: "500",
                      fontSize: 14,
                      borderRadius: 6,
                      border: "none",
                      backgroundColor:
                        selectedModel === "modelA" ? "#1976d2" : "#90caf9",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Gemma
                  </button>
                  <button
                    onClick={() => setSelectedModel("modelB")}
                    style={{
                      flex: 1,
                      padding: "10px",
                      fontWeight: "500",
                      fontSize: 14,
                      borderRadius: 6,
                      border: "none",
                      backgroundColor:
                        selectedModel === "modelB" ? "#1976d2" : "#90caf9",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Llama
                  </button>
                </div>
              )}
            </div>

            {/* Scrollable Content */}
            <div
              ref={summaryScrollRef}
              style={{
                flex: 1,
                overflowY: "auto",
                paddingRight: 4,
                paddingTop: 10,
              }}
            >
              {role === "doctor" ? (
                emotionSummaries.length === 0 ? (
                  <p style={{ color: "#777" }}>No summary received yet.</p>
                ) : (
                  <ul style={{ paddingLeft: 16, margin: 0 }}>
                    {emotionSummaries.map((entry, idx) => {
                      const summary =
                        selectedModel === "modelA"
                          ? entry.modelA
                          : entry.modelB;
                      return (
                        <li
                          key={idx}
                          style={{
                            fontSize: 15,
                            lineHeight: "1.6",
                            marginBottom: 10,
                            listStyle: "disc",
                          }}
                        >
                          <strong>
                            {new Date(entry.timestamp).toLocaleTimeString()}:
                          </strong>{" "}
                          {summary ? (
                            summary
                          ) : (
                            <span style={{ color: "#999" }}>No data</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : (
                <div style={{ fontSize: 15, lineHeight: 1.6 }}>
                  <p>
                    Thank you for joining the session. Please read the following
                    before we begin:
                  </p>
                  <ul style={{ paddingLeft: 18 }}>
                    <li>
                      🛡️ <strong>Consent:</strong> By participating in this
                      session, you agree to audio and video recording for
                      emotional analysis purposes.
                    </li>
                    <li>
                      🎥 <strong>Stay Visible:</strong> Keep your face clearly
                      visible in the camera frame.
                    </li>
                    <li>
                      🔇 <strong>Background Noise:</strong> Ensure a quiet
                      environment to improve audio analysis.
                    </li>
                    <li>
                      💬 <strong>Feel Free to Express:</strong> Speak naturally.
                      Emotional cues help improve our insights.
                    </li>
                    <li>
                      🧘 <strong>Stay Relaxed:</strong> There is no judgment —
                      the session is for your well-being.
                    </li>
                  </ul>
                  <p
                    style={{
                      marginTop: 16,
                      fontStyle: "italic",
                      color: "#555",
                    }}
                  >
                    This session is confidential and your data will be handled
                    securely.
                  </p>
                </div>
              )}
            </div>
          </div>

          {role === "doctor" && showFinalModal && (
            <div
              style={{
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                background: "white",
                borderRadius: 12,
                padding: 32,
                boxShadow: "0 0 16px rgba(0,0,0,0.3)",
                zIndex: 999,
                width: "60%",
                height: "70%",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <h2 style={{ textAlign: "center", marginBottom: 20 }}>
                🧠 Emotional Summary
              </h2>

              <div
                style={{
                  display: "flex",
                  flex: 1,
                  gap: 20,
                  overflow: "auto",
                }}
              >
                {/* Model A */}
                <div
                  style={{ flex: 1, display: "flex", flexDirection: "column" }}
                >
                  <div
                    style={{
                      padding: "10px 16px",
                      fontWeight: "bold",
                      fontSize: 16,
                      textAlign: "center",
                      backgroundColor: "#1976d2",
                      color: "#fff",
                      borderTopLeftRadius: 8,
                      borderTopRightRadius: 8,
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                    }}
                  >
                    Gemma
                  </div>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      backgroundColor: "#f9f9f9",
                      padding: 12,
                      borderRadius: "0 0 8px 8px",
                      border: "1px solid #ddd",
                      height: "100%",
                      overflowY: "auto",
                    }}
                  >
                    {finalModalResult.modelA || "No data"}
                  </pre>
                </div>

                <div
                  style={{
                    width: 1,
                    background:
                      "repeating-linear-gradient(to bottom, #ccc, #ccc 4px, transparent 4px, transparent 8px)",
                  }}
                />

                {/* Model B */}
                <div
                  style={{ flex: 1, display: "flex", flexDirection: "column" }}
                >
                  <div
                    style={{
                      padding: "10px 16px",
                      fontWeight: "bold",
                      fontSize: 16,
                      textAlign: "center",
                      backgroundColor: "#1976d2",
                      color: "#fff",
                      borderTopLeftRadius: 8,
                      borderTopRightRadius: 8,
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                    }}
                  >
                    Llama
                  </div>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      backgroundColor: "#f9f9f9",
                      padding: 12,
                      borderRadius: "0 0 8px 8px",
                      border: "1px solid #ddd",
                      height: "100%",
                      overflowY: "auto",
                    }}
                  >
                    {finalModalResult.modelB || "No data"}
                  </pre>
                </div>
              </div>

              <button
                onClick={() => {
                  setJoined(false);
                  setEmotionSummaries([]);
                  setSelectedModel("modelA");
                  setRemoteUserInfo({ name: "", role: "" });
                  setRole("");
                  setName("");
                  setShowFinalModal(false);
                }}
                style={{
                  marginTop: 24,
                  alignSelf: "center",
                  padding: "10px 20px",
                  backgroundColor: "#1976d2",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                Close
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
