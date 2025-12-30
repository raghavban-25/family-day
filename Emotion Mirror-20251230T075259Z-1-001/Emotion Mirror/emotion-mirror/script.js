// 1. Import from your LOCAL file
let FaceLandmarker, FilesetResolver, DrawingUtils;

// Initialize everything when DOM is ready
async function init() {
  const video = document.getElementById("webcam");
  const canvasElement = document.getElementById("output");
  const canvasCtx = canvasElement.getContext("2d");
  const resultText = document.getElementById("emotion-result");

  // Get emotion symbol elements
  const emotionNeutral = document.getElementById("emotion-neutral");
  const emotionHappy = document.getElementById("emotion-happy");
  const emotionAngry = document.getElementById("emotion-angry");
  const emotionSurprised = document.getElementById("emotion-surprised");

  // Initialize neutral as active by default
  if (emotionNeutral) {
    emotionNeutral.classList.add("active");
  }

  // Timer controls: start button and countdown
  const startButton = document.getElementById("start-button");
  if (startButton) startButton.disabled = true;
  const countdownEl = document.getElementById("countdown");
  let countdownInterval = null;
  let countdownRemaining = 30;

  function formatTime(s) {
    const mm = Math.floor(s / 60).toString().padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function speak(text) {
    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(u);
      }
    } catch (e) {
      console.warn("Speech failed:", e);
    }
  }

  function updateCountdownDisplay() {
    if (countdownEl) countdownEl.innerText = formatTime(countdownRemaining);
  }

  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (startButton) startButton.disabled = false;
  }

  function resetToInitialState() {
    // Ensure countdown stopped and camera stopped
    stopCountdown();
    try {
      stopCamera();
    } catch (e) {
      console.warn('Error stopping camera during reset', e);
    }

    // Cancel any ongoing speech
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) {}

    // Reset countdown display
    countdownRemaining = 30;
    updateCountdownDisplay();

    // Reset placement UI and progress
    setPlacementTarget(0);

    // Reset active emotion to neutral
    try {
      [emotionNeutral, emotionHappy, emotionAngry, emotionSurprised].forEach((el) => {
        if (el) el.classList.remove('active');
      });
      if (emotionNeutral) emotionNeutral.classList.add('active');
    } catch (e) {}

    // Reset result text
    resultText.innerText = 'AI Ready! Press Start.';
    resultText.style.color = 'white';

    if (startButton) startButton.disabled = false;
  }

  function startCountdown() {
    // reset
    stopCountdown();
    countdownRemaining = 30;
    updateCountdownDisplay();
    if (startButton) startButton.disabled = true;

    // Ensure camera/detection starts when countdown begins
    if (!faceLandmarker) {
      // If model isn't loaded yet, wait for it. Attempt to load now as fallback.
      setupAI();
    }
    // Start camera if not already streaming
    if (video && !video.srcObject) {
      startCamera();
    }

    // immediate check if 30 equals threshold? We only announce at 10s and at end.
    countdownInterval = setInterval(() => {
      countdownRemaining -= 1;
      updateCountdownDisplay();
      if (countdownRemaining === 10) {
        speak("Only 10 seconds left");
      }
      if (countdownRemaining <= 0) {
        stopCountdown();
        // final announcement
        speak("Time's up");
        // show time up in result box
        resultText.innerText = "Time's up!";
        resultText.style.color = "#ffcc00";
        // stop detection and camera
        try {
          stopCamera();
        } catch (e) {
          console.warn('Failed to stop camera at time up', e);
        }
        // After a short pause, reset UI back to initial ready state so the user can Start again
        setTimeout(() => {
          try {
            resetToInitialState();
          } catch (e) {
            console.warn('reset failed', e);
          }
        }, 1200);
      }
    }, 1000);
  }

  if (startButton) {
    startButton.addEventListener("click", startCountdown);
    // ensure display initial value
    updateCountdownDisplay();
  }

  // Placement / target tracking UI
  const placementEmojiEl = document.getElementById("placement-emoji");
  const placementBarEl = document.getElementById("placement-bar");
  const placementLabelEl = document.getElementById("placement-label");
  const targets = ["neutral", "happy", "angry", "surprised"];
  let currentTargetIndex = 0;
  let targetHoldTime = 0;
  const requiredHold = 5; // seconds required to hold an emotion to advance
  let lastHoldTs = null;
  let placementComplete = false;

  function setPlacementTarget(index) {
    currentTargetIndex = Math.max(0, Math.min(index, targets.length - 1));
    const key = targets[currentTargetIndex];
    // try to read emoji char from existing element
    const el = document.getElementById(`emotion-${key}`);
    let ch = key.toUpperCase();
    if (el) {
      const icon = el.querySelector(".emotion-emoji");
      if (icon) ch = icon.innerText;
    }
    if (placementEmojiEl) placementEmojiEl.innerText = ch;
    if (placementLabelEl) placementLabelEl.innerText = `Hold: ${key.toUpperCase()}`;
    if (placementBarEl) placementBarEl.style.width = `0%`;
    targetHoldTime = 0;
    lastHoldTs = null;
    placementComplete = false;
  }

  // initialize placement UI
  setPlacementTarget(0);

  let faceLandmarker;
  let runningMode = "VIDEO";
  let lastVideoTime = -1;
  let detecting = false; // whether detection loop should run

  // Load the vision bundle
  try {
    const visionModule = await import("./assets/vision_bundle.js");
    FaceLandmarker = visionModule.FaceLandmarker;
    FilesetResolver = visionModule.FilesetResolver;
    DrawingUtils = visionModule.DrawingUtils;
  } catch (e) {
    console.error("Failed to load vision_bundle.js:", e);
    resultText.innerText =
      "Error: vision_bundle.js not found! Run download_assets.py first.";
    resultText.style.color = "red";
    return;
  }

  // --- SETUP: LOAD AI OFFLINE ---
  async function setupAI() {
    try {
      // Point to the folder containing the WASM files
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "./assets/mediapipe"
      );

      // Load the Model
      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: "./assets/mediapipe/face_landmarker.task",
          delegate: "GPU",
        },
        outputFaceBlendshapes: true, // <--- CRITICAL: Enables emotion scores
        runningMode: runningMode,
        numFaces: 1,
      });

      resultText.innerText = "AI Ready! Press Start.";
      // Enable the start button once the model is loaded
      if (startButton) startButton.disabled = false;
    } catch (e) {
      console.error("Setup error:", e);
      resultText.innerText = "Error: Check assets/mediapipe folder!";
      resultText.style.color = "red";
    }
  }

  // --- WEBCAM SETUP ---
  async function startCamera() {
    try {
      if (detecting) return; // already running
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      detecting = true;
      // start the prediction loop immediately
      requestAnimationFrame(predictWebcam);
    } catch (e) {
      console.error("Camera access error:", e);
      resultText.innerText = "Error: Camera access denied or unavailable!";
      resultText.style.color = "red";
    }
  }

  function stopCamera() {
    try {
      detecting = false;
      if (video && video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach((t) => t.stop());
        video.srcObject = null;
      }
    } catch (e) {
      console.warn("Error stopping camera:", e);
    }
  }

  // --- PREDICTION LOOP ---
  async function predictWebcam() {
    // Check if faceLandmarker is initialized and detection is active
    if (!faceLandmarker || !detecting) {
      return;
    }

    let startTimeMs = performance.now();

    if (lastVideoTime !== video.currentTime) {
      lastVideoTime = video.currentTime;
      try {
        const results = faceLandmarker.detectForVideo(video, startTimeMs);

        if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
          // Get the list of 52 muscle scores (0.0 to 1.0)
          const shapes = results.faceBlendshapes[0].categories;
          detectEmotion(shapes);
        } else {
          // No face detected - show neutral
          if (
            emotionNeutral &&
            emotionHappy &&
            emotionAngry &&
            emotionSurprised
          ) {
            emotionNeutral.classList.remove("active");
            emotionHappy.classList.remove("active");
            emotionAngry.classList.remove("active");
            emotionSurprised.classList.remove("active");
            emotionNeutral.classList.add("active");
          }
        }
      } catch (e) {
        console.error("Detection error:", e);
      }
    }
    if (detecting) requestAnimationFrame(predictWebcam);
  }

  // --- LOGIC: CONVERT MUSCLES TO EMOTIONS ---
  function detectEmotion(blendshapes) {
    // Check if emotion elements exist
    if (
      !emotionNeutral ||
      !emotionHappy ||
      !emotionAngry ||
      !emotionSurprised
    ) {
      console.error("Emotion elements not found!");
      return;
    }

    // Helper to find score by name
    const getScore = (name) => {
      const shape = blendshapes.find((s) => s.categoryName === name);
      return shape ? shape.score : 0;
    };

    // Calculate emotion scores
    const smile = getScore("mouthSmileLeft") + getScore("mouthSmileRight");

    // For angry: check brow down (frowning) - use inner brow down which is more accurate for anger
    const browDown =
      getScore("browInnerDown") +
      getScore("browDownLeft") +
      getScore("browDownRight");

    // For surprised: check wide eyes AND raised eyebrows
    const eyeOpen = getScore("eyeWideLeft") + getScore("eyeWideRight");
    const browUp =
      getScore("browInnerUp") +
      getScore("browOuterUpLeft") +
      getScore("browOuterUpRight");
    const surprised = eyeOpen + browUp * 0.5; // Combine eye wide and brow up

    let emotion = "NEUTRAL 😐";
    let color = "white";
    let activeEmotion = "neutral";

    // Remove active class from all emotion items
    emotionNeutral.classList.remove("active");
    emotionHappy.classList.remove("active");
    emotionAngry.classList.remove("active");
    emotionSurprised.classList.remove("active");

    // Check emotions with adjusted thresholds
    // Priority: Happy > Angry > Surprised > Neutral
    if (smile > 0.6) {
      emotion = "HAPPY! 😄";
      color = "#00ff00";
      activeEmotion = "happy";
      emotionHappy.classList.add("active");
    } else if (browDown > 0.5) {
      emotion = "ANGRY 😠";
      color = "red";
      activeEmotion = "angry";
      emotionAngry.classList.add("active");
    } else if (surprised > 0.8) {
      emotion = "SURPRISED 😲";
      color = "yellow";
      activeEmotion = "surprised";
      emotionSurprised.classList.add("active");
    } else {
      activeEmotion = "neutral";
      emotionNeutral.classList.add("active");
    }

    resultText.innerText = emotion;
    resultText.style.color = color;

    // --- Placement / target tracking ---
    if (!placementComplete) {
      const now = performance.now();
      if (lastHoldTs === null) lastHoldTs = now;
      const delta = (now - lastHoldTs) / 1000.0;

      const currentTarget = targets[currentTargetIndex];
      if (activeEmotion === currentTarget) {
        targetHoldTime += delta;
      } else {
        // reset when user stops matching the required emotion
        targetHoldTime = 0;
      }
      lastHoldTs = now;

      // update progress bar
      const pct = Math.min(100, (targetHoldTime / requiredHold) * 100);
      if (placementBarEl) placementBarEl.style.width = pct + "%";

      // advance when held long enough
      if (targetHoldTime >= requiredHold) {
        currentTargetIndex += 1;
        if (currentTargetIndex >= targets.length) {
          // completed the sequence
          placementComplete = true;
          if (placementLabelEl) placementLabelEl.innerText = "Placement complete";
          if (placementBarEl) placementBarEl.style.width = "100%";
        } else {
          setPlacementTarget(currentTargetIndex);
        }
      }
    }
  }

  // Start
  setupAI();
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
