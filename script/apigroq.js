const Groq = require("groq-sdk");
const { generatePrompt, checkActivePrompts } = require("./prompt");
const obtenerApiKey = require("./apikeydb");

let groq;

const initializeGroq = async () => {
  try {
    const apiKey = await obtenerApiKey('api_key_ia3');
    if (!apiKey) {
      console.error('API key not found');
      return;
    }
    groq = new Groq({ apiKey });
  } catch (error) {
    console.error('Error obtaining API key:', error);
  }
};

const run = async (name, history, teamId) => {
  if (!groq) {
    await initializeGroq();
    if (!groq) return '';
  }

  const activePrompts = await checkActivePrompts(teamId);
  if (!activePrompts) {
    return '';
  }

  const prompt = await generatePrompt(name);
  const response = await groq.chat.completions.create({
    model: "llama3-8b-8192",
    messages: [
      {
        role: "system",
        content: prompt
      },
      ...history
    ],
    temperature: 0.7,
    max_tokens: 200,
    top_p: 1,
    frequency_penalty: 0.5,
    presence_penalty: 0.3,
  });
  return response.choices[0].message.content;
};

const runDetermine = async (history, teamId) => {
  if (!groq) {
    await initializeGroq();
    if (!groq) return '';
  }

  const activePrompts = await checkActivePrompts(teamId);
  if (!activePrompts) {
    return '';
  }

  const prompt = await generatePrompt('client');
  const response = await groq.chat.completions.create({
    model: "llama3-8b-8192",
    messages: [
      {
        role: "system",
        content: prompt
      },
      ...history
    ],
    temperature: 0.7,
    max_tokens: 200,
    top_p: 1,
    frequency_penalty: 0.5,
    presence_penalty: 0.3,
  });
  return response.choices[0].message.content;
};

module.exports = { run, runDetermine };
