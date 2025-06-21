// import React, { useEffect, useRef, useState } from "react";
// import io from "socket.io-client";
// import * as mediasoupClient from "mediasoup-client";

// const socket = io("http://192.168.0.216:3001");

// function App() {
//   const [isAudioMuted, setIsAudioMuted] = useState(false);
//   const [isVideoMuted, setIsVideoMuted] = useState(false);
//   const [name, setName] = useState("");
//   const [joined, setJoined] = useState(false);
//   const [role, setRole] = useState("");
//   const [audioSamples, setAudioSamples] = useState(0);
//   const [videoFrames, setVideoFrames] = useState(0);

//   const localStreamRef = useRef(null);
//   const localVideo = useRef(null);
//   const remoteVideo = useRef(null);
//   const deviceRef = useRef(null);
//   const sendTransportRef = useRef(null);
//   const recvTransportRef = useRef(null);
//   const [remoteStream] = useState(new MediaStream());
//   const initialized = useRef(false);

//   const audioContextRef = useRef(null);
//   const audioSourceRef = useRef(null);
//   const audioProcessorRef = useRef(null);
//   const audioDataRef = useRef([]);
//   const videoDataRef = useRef([]);
//   const canvasRef = useRef(null);
//   const captureVideo = useRef(true);

//   useEffect(() => {
//     if (!joined || initialized.current) return;
//     initialized.current = true;

//     const start = async () => {
//       const stream = await navigator.mediaDevices.getUserMedia({
//         video: true,
//         audio: true,
//       });

//       localStreamRef.current = stream;
//       if (localVideo.current) localVideo.current.srcObject = stream;

//       const audioContext = new AudioContext({ sampleRate: 48000 });
//       audioContextRef.current = audioContext;
//       const source = audioContext.createMediaStreamSource(stream);
//       audioSourceRef.current = source;
//       const processor = audioContext.createScriptProcessor(4096, 1, 1);
//       audioProcessorRef.current = processor;

//       source.connect(processor);
//       processor.connect(audioContext.destination);

//       processor.onaudioprocess = (e) => {
//         const pcm = e.inputBuffer.getChannelData(0);
//         audioDataRef.current.push(...pcm);
//         setAudioSamples((prev) => prev + pcm.length);

//         // Send raw audio to backend (convert Float32Array to Base64)
//         const float32 = new Float32Array(pcm);
//         const buffer = new Uint8Array(float32.buffer);
//         const base64 = btoa(String.fromCharCode(...buffer.slice(0, 1024))); // batching
//         console.log(base64, "base64 Audio");
//         socket.emit("audio-data", base64);
//       };

//       const videoEl = document.createElement("video");
//       videoEl.srcObject = new MediaStream([stream.getVideoTracks()[0]]);
//       await videoEl.play().catch(() => {});
//       const canvas = document.createElement("canvas");
//       canvasRef.current = canvas;
//       const ctx = canvas.getContext("2d");

//       const captureFrame = () => {
//         if (!captureVideo.current) return;
//         try {
//           if (videoEl.videoWidth && videoEl.videoHeight) {
//             canvas.width = videoEl.videoWidth;
//             canvas.height = videoEl.videoHeight;
//             ctx.drawImage(videoEl, 0, 0);
//             const imageData = ctx.getImageData(
//               0,
//               0,
//               canvas.width,
//               canvas.height
//             );
//             const rgba = imageData.data;
//             const yuv = rgbaToYuv(rgba, canvas.width, canvas.height);
//             videoDataRef.current.push(yuv);
//             const base64Video = btoa(
//               String.fromCharCode(...yuv.slice(0, 1024))
//             ); // batching
//             console.log(base64Video, "base64Video");
//             socket.emit("video-data", base64Video);
//             setVideoFrames((prev) => prev + 1);
//           }
//         } catch (err) {
//           console.error("Frame capture error:", err.message);
//         }
//         requestAnimationFrame(captureFrame);
//       };

//       requestAnimationFrame(captureFrame);

//       const rtpCapabilities = await new Promise((res) =>
//         socket.emit("getRtpCapabilities", res)
//       );

//       const device = new mediasoupClient.Device();
//       await device.load({ routerRtpCapabilities: rtpCapabilities });
//       deviceRef.current = device;

//       const sendParams = await new Promise((res) =>
//         socket.emit("createWebRtcTransport", {}, res)
//       );
//       const sendTransport = device.createSendTransport(sendParams);
//       sendTransportRef.current = sendTransport;

//       sendTransport.on("connect", ({ dtlsParameters }, callback) => {
//         socket.emit(
//           "connectTransport",
//           { transportId: sendTransport.id, dtlsParameters },
//           callback
//         );
//       });

//       sendTransport.on(
//         "produce",
//         async ({ kind, rtpParameters, appData }, callback) => {
//           const { id } = await new Promise((res) =>
//             socket.emit("produce", { kind, rtpParameters, appData }, res)
//           );
//           callback({ id });
//         }
//       );

//       const audioTrack = stream.getAudioTracks()[0];
//       const videoTrack = stream.getVideoTracks()[0];

//       if (audioTrack) {
//         await sendTransport.produce({
//           track: audioTrack,
//           appData: { mediaTag: `audio-${socket.id}` },
//         });
//       }

//       if (videoTrack) {
//         await sendTransport.produce({
//           track: videoTrack,
//           appData: { mediaTag: `video-${socket.id}` },
//         });
//       }

//       const recvParams = await new Promise((res) =>
//         socket.emit("createWebRtcTransport", {}, res)
//       );
//       const recvTransport = device.createRecvTransport(recvParams);
//       recvTransportRef.current = recvTransport;

//       recvTransport.on("connect", ({ dtlsParameters }, callback) => {
//         socket.emit(
//           "connectTransport",
//           { transportId: recvTransport.id, dtlsParameters },
//           callback
//         );
//       });

//       socket.emit("getCurrentProducers", async (producerList) => {
//         for (const { producerId } of producerList) {
//           const consumeParams = await new Promise((res) =>
//             socket.emit(
//               "consume",
//               { rtpCapabilities: device.rtpCapabilities, producerId },
//               res
//             )
//           );

//           const consumer = await recvTransport.consume({
//             id: consumeParams.id,
//             producerId: consumeParams.producerId,
//             kind: consumeParams.kind,
//             rtpParameters: consumeParams.rtpParameters,
//           });

//           remoteStream.addTrack(consumer.track);
//           if (remoteVideo.current) {
//             remoteVideo.current.srcObject = remoteStream;
//           }
//         }
//       });

//       socket.on("newProducer", async ({ producerId }) => {
//         const consumeParams = await new Promise((res) =>
//           socket.emit(
//             "consume",
//             { rtpCapabilities: device.rtpCapabilities, producerId },
//             res
//           )
//         );

//         const consumer = await recvTransport.consume({
//           id: consumeParams.id,
//           producerId: consumeParams.producerId,
//           kind: consumeParams.kind,
//           rtpParameters: consumeParams.rtpParameters,
//         });

//         remoteStream.addTrack(consumer.track);
//         if (remoteVideo.current) {
//           remoteVideo.current.srcObject = remoteStream;
//         }
//       });
//     };

//     start();
//   }, [joined]);

//   const rgbaToYuv = (rgba, width, height) => {
//     const yuv = new Uint8Array(width * height * 1.5);
//     let yIndex = 0,
//       uIndex = width * height,
//       vIndex = uIndex + (width * height) / 4;
//     for (let i = 0; i < rgba.length; i += 4) {
//       const r = rgba[i],
//         g = rgba[i + 1],
//         b = rgba[i + 2];
//       yuv[yIndex++] = 0.299 * r + 0.587 * g + 0.114 * b;
//       if (i % 8 === 0) {
//         yuv[uIndex++] = -0.169 * r - 0.331 * g + 0.5 * b + 128;
//         yuv[vIndex++] = 0.5 * r - 0.419 * g - 0.081 * b + 128;
//       }
//     }
//     return yuv;
//   };

//   const toggleAudio = () => {
//     const stream = localStreamRef.current;
//     if (!stream) return;
//     const audioTrack = stream.getAudioTracks()[0];
//     if (audioTrack) {
//       audioTrack.enabled = !audioTrack.enabled;
//       setIsAudioMuted(!audioTrack.enabled);
//     }
//   };

//   const toggleVideo = () => {
//     const stream = localStreamRef.current;
//     if (!stream) return;
//     const videoTrack = stream.getVideoTracks()[0];
//     if (videoTrack) {
//       videoTrack.enabled = !videoTrack.enabled;
//       setIsVideoMuted(!videoTrack.enabled);
//     }
//   };

//   const hangUp = () => {
//     if (localVideo.current?.srcObject) {
//       localVideo.current.srcObject.getTracks().forEach((track) => track.stop());
//       localVideo.current.srcObject = null;
//     }

//     if (remoteVideo.current?.srcObject) {
//       remoteVideo.current.srcObject
//         .getTracks()
//         .forEach((track) => track.stop());
//       remoteVideo.current.srcObject = null;
//     }

//     if (sendTransportRef.current) sendTransportRef.current.close();
//     if (recvTransportRef.current) recvTransportRef.current.close();

//     socket.emit("hangUp");

//     captureVideo.current = false;

//     if (audioProcessorRef.current) audioProcessorRef.current.disconnect();
//     if (audioSourceRef.current) audioSourceRef.current.disconnect();
//     if (audioContextRef.current) {
//       audioContextRef.current.close();
//       audioContextRef.current = null;
//     }
//   };

//   const handleJoin = () => {
//     socket.emit("joinMeeting", { name }, ({ assignedRole }) => {
//       setRole(assignedRole);
//       setJoined(true);
//     });
//   };

//   return (
//     <div style={{ padding: 20 }}>
//       {!joined ? (
//         <div>
//           <h3>Enter your name to join:</h3>
//           <input
//             placeholder="Your name"
//             value={name}
//             onChange={(e) => setName(e.target.value)}
//           />
//           <button onClick={handleJoin} style={{ marginLeft: 10 }}>
//             Join Meeting
//           </button>
//         </div>
//       ) : (
//         <>
//           <h3>Name: {name}</h3>
//           <h4>Role: {role}</h4>

//           <h2>Local Video</h2>
//           <video
//             ref={localVideo}
//             autoPlay
//             muted
//             style={{ width: "45%", marginRight: "10%" }}
//           />
//           <h2>Remote Video</h2>
//           <video ref={remoteVideo} autoPlay style={{ width: "45%" }} />

//           <div style={{ marginTop: 20 }}>
//             <button onClick={toggleAudio}>
//               {isAudioMuted ? "Unmute Audio" : "Mute Audio"}
//             </button>
//             <button onClick={toggleVideo} style={{ marginLeft: 10 }}>
//               {isVideoMuted ? "Unmute Video" : "Mute Video"}
//             </button>
//           </div>

//           <div style={{ marginTop: 20 }}>
//             <p>Audio Samples Captured: {audioSamples}</p>
//             <p>Video Frames Captured: {videoFrames}</p>
//           </div>

//           <button onClick={hangUp}>Hang Up</button>
//         </>
//       )}
//     </div>
//   );
// }

// export default App;

import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

const socket = io("http://192.168.0.216:3001");

function App() {
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [role, setRole] = useState("");
  const [audioSamples, setAudioSamples] = useState(0);
  const [videoFrames, setVideoFrames] = useState(0);

  const localStreamRef = useRef(null);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const [remoteStream] = useState(new MediaStream());
  const initialized = useRef(false);

  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const audioDataRef = useRef([]);
  const videoDataRef = useRef([]);
  const canvasRef = useRef(null);
  const captureVideo = useRef(true);

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
        setAudioSamples((prev) => prev + pcm.length);
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
            setVideoFrames((prev) => prev + 1);
          }
        } catch (err) {
          console.error("Frame capture error:", err.message);
        }
        requestAnimationFrame(captureFrame);
      };

      requestAnimationFrame(captureFrame);

      setInterval(() => {
        const timestamp = new Date().toISOString();

        // AUDIO
        if (audioDataRef.current.length > 0) {
          const float32 = new Float32Array(audioDataRef.current);
          const buffer = new Uint8Array(float32.buffer);
          const safeChunk = buffer.slice(0, 100000); // prevent RangeError
          const base64 = btoa(String.fromCharCode(...safeChunk));
          socket.emit("audio-data", { timestamp, base64 });
          audioDataRef.current = [];
        }

        // VIDEO
        if (videoDataRef.current.length > 0) {
          const allYUV = videoDataRef.current.flat();
          const safeChunk = allYUV.slice(0, 100000); // prevent RangeError
          const base64 = btoa(String.fromCharCode(...safeChunk));
          socket.emit("video-data", { timestamp, base64 });
          videoDataRef.current = [];
        }
      }, 10000);

      // setInterval(() => {
      //   // AUDIO
      //   if (audioDataRef.current.length > 0) {
      //     const float32 = new Float32Array(audioDataRef.current);
      //     const buffer = new Uint8Array(float32.buffer);
      //     const safeChunk = buffer.slice(0, 100000); // limit to avoid RangeError
      //     const base64 = btoa(String.fromCharCode(...safeChunk));
      //     socket.emit("audio-data", base64);
      //     audioDataRef.current = [];
      //   }

      //   // VIDEO
      //   if (videoDataRef.current.length > 0) {
      //     const allYUV = videoDataRef.current.flat();
      //     const safeChunk = allYUV.slice(0, 100000); // limit to avoid RangeError
      //     const base64 = btoa(String.fromCharCode(...safeChunk));
      //     socket.emit("video-data", base64);
      //     videoDataRef.current = [];
      //   }
      // }, 10000);

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
        for (const { producerId } of producerList) {
          const consumeParams = await new Promise((res) =>
            socket.emit(
              "consume",
              { rtpCapabilities: device.rtpCapabilities, producerId },
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
        }
      });

      socket.on("newProducer", async ({ producerId }) => {
        const consumeParams = await new Promise((res) =>
          socket.emit(
            "consume",
            { rtpCapabilities: device.rtpCapabilities, producerId },
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

    if (sendTransportRef.current) sendTransportRef.current.close();
    if (recvTransportRef.current) recvTransportRef.current.close();

    socket.emit("hangUp");

    captureVideo.current = false;

    if (audioProcessorRef.current) audioProcessorRef.current.disconnect();
    if (audioSourceRef.current) audioSourceRef.current.disconnect();
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const handleJoin = () => {
    socket.emit("joinMeeting", { name }, ({ assignedRole }) => {
      setRole(assignedRole);
      setJoined(true);
    });
  };

  return (
    <div style={{ padding: 20 }}>
      {!joined ? (
        <div>
          <h3>Enter your name to join:</h3>
          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button onClick={handleJoin} style={{ marginLeft: 10 }}>
            Join Meeting
          </button>
        </div>
      ) : (
        <>
          <h3>Name: {name}</h3>
          <h4>Role: {role}</h4>

          <h2>Local Video</h2>
          <video
            ref={localVideo}
            autoPlay
            muted
            style={{ width: "45%", marginRight: "10%" }}
          />
          <h2>Remote Video</h2>
          <video ref={remoteVideo} autoPlay style={{ width: "45%" }} />

          <div style={{ marginTop: 20 }}>
            <button onClick={toggleAudio}>
              {isAudioMuted ? "Unmute Audio" : "Mute Audio"}
            </button>
            <button onClick={toggleVideo} style={{ marginLeft: 10 }}>
              {isVideoMuted ? "Unmute Video" : "Mute Video"}
            </button>
          </div>

          <div style={{ marginTop: 20 }}>
            <p>Audio Samples Captured: {audioSamples}</p>
            <p>Video Frames Captured: {videoFrames}</p>
          </div>

          <button onClick={hangUp}>Hang Up</button>
        </>
      )}
    </div>
  );
}

export default App;
