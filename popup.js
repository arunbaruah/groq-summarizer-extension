const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const summarizeBtn = document.getElementById("summarizeBtn");
const transcribeBtn = document.getElementById("transcribeBtn");
const outputDiv = document.getElementById("output");

// Load saved settings
chrome.storage.local.get(["groqApiKey", "groqModel"], (data) => {
  if (data.groqApiKey) apiKeyInput.value = data.groqApiKey;
  if (data.groqModel) modelInput.value = data.groqModel;
});

// Save settings
apiKeyInput.addEventListener("change", () => {
  chrome.storage.local.set({ groqApiKey: apiKeyInput.value });
});
modelInput.addEventListener("change", () => {
  chrome.storage.local.set({ groqModel: modelInput.value });
});

// 🔹 Helper: call Groq API with fetch
async function summarizeWithGroq(apiKey, model, text) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model || "openai/gpt-oss-20b",
      messages: [{ role: "user", content: text }],
      temperature: 0.7,
      max_tokens: 512
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// 🔹 Helper: get full page text
function getPageText() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          func: () => document.body.innerText // grab whole visible page text
        },
        (results) => {
          resolve(results[0].result);
        }
      );
    });
  });
}

// 🔹 Summarize page handler
summarizeBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim();

  if (!apiKey) {
    outputDiv.textContent = "Please enter your Groq API key.";
    return;
  }

  const pageText = await getPageText();
  if (!pageText || pageText.length < 50) {
    outputDiv.textContent = "Could not extract enough text from this page.";
    return;
  }

  outputDiv.textContent = "Summarizing page...";

  try {
    const summary = await summarizeWithGroq(
      apiKey,
      model,
      `Summarize the following webpage content:\n\n${pageText}`
    );
    outputDiv.textContent = summary;
  } catch (err) {
    console.error(err);
    outputDiv.textContent = "X" + err.message;
  }
});

// 🔹 YouTube transcript + summarization handler
transcribeBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim();

  if (!apiKey) {
    outputDiv.textContent = "Please enter your Groq API key.";
    return;
  }

  outputDiv.textContent = "Fetching transcript...";

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabs[0].id },
        func: () => {
          try {
            const playerResponse = window.ytInitialPlayerResponse;
            if (!playerResponse || !playerResponse.captions) {
              return { error: "No captions available for this video." };
            }

            const tracks =
              playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
            if (!tracks || tracks.length === 0) {
              return { error: "No captions found." };
            }

            // Prefer English captions, fallback to first available
            let track = tracks.find(t => t.languageCode === "en") || tracks[0];

            return { trackUrl: track.baseUrl, lang: track.languageCode };
          } catch (e) {
            return { error: e.message };
          }
        }
      },
      async (results) => {
        const res = results[0].result;

        if (res.error) {
          outputDiv.textContent = "X" + res.error;
          return;
        }

        try {
          const response = await fetch(res.trackUrl);
          const text = await response.text();

          const parser = new DOMParser();
          const xml = parser.parseFromString(text, "text/xml");
          const texts = Array.from(xml.getElementsByTagName("text"));
          const transcript = texts
            .map((node) => node.textContent.replace(/&#39;/g, "'"))
            .join(" ");

          if (!transcript || transcript.length < 50) {
            outputDiv.textContent = "Could not extract transcript text.";
            return;
          }

          outputDiv.textContent = `Summarizing transcript (language: ${res.lang})...`;

          const summary = await summarizeWithGroq(
            apiKey,
            model,
            `Summarize this transcript:\n\n${transcript}`
          );

          outputDiv.textContent = `Transcript (first 500 chars):\n${transcript.slice(
            0,
            500
          )}...\n\n✨ Summary:\n${summary}`;
        } catch (err) {
          console.error(err);
          outputDiv.textContent = "Error fetching transcript: " + err.message;
        }
      }
    );
  });
});
