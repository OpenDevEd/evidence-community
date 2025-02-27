const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
  } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
  
const routingFile = fs.readFileSync(path.join(__dirname, '../src/i18n/routing.ts'), 'utf8');
const localesMatch = routingFile.match(/locales:\s*(\[.*?\])/);
const locales = JSON.parse(
  localesMatch[1].replace(/'/g, '"')
);
  
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Please set the GEMINI_API_KEY environment variable");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(apiKey);
  
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-lite",
});
  
const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "application/json",
};
  
async function run() {
  const [word, objectPath, context] = process.argv.slice(2);

  if (!word || !objectPath) {
    console.error("Please provide a word/sentence to translate and either the parent object (e.g., 'ai') or full path (e.g., 'ai.cookRecipe')");
    process.exit(1);
  }

  let needsKeyGeneration = !objectPath.includes('.');

  const initialPrompt = context 
    ? `You will be given a word/sentence in en-GB and some context, based on the context, translate the word to the following locales: ${JSON.stringify(locales)}

Input: "${word}"
Context: "${context}"

${needsKeyGeneration ? `Respond with a JSON object containing:
1. A "key" field with a suggested camelCase key name
2. A "translations" object with the locale translations

Example format:
{
  "key": "suggestedKey",
  "translations": {
    ${locales.map(locale => `"${locale}": "translation in ${locale}"`).join(',\n    ')}
  }
}` : `Respond with a JSON object containing translations:
{
  ${locales.map(locale => `"${locale}": "translation in ${locale}"`).join(',\n  ')}
}`}` 
    : `You will be given a word/sentence in en-GB, translate it to the following locales: ${JSON.stringify(locales)}

Input: "${word}"

${needsKeyGeneration ? `Respond with a JSON object containing:
1. A "key" field with a suggested camelCase key name
2. A "translations" object with the locale translations

Example format:
{
  "key": "suggestedKey",
  "translations": {
    ${locales.map(locale => `"${locale}": "translation in ${locale}"`).join(',\n    ')}
  }
}` : `Respond with a JSON object containing translations:
{
  ${locales.map(locale => `"${locale}": "translation in ${locale}"`).join(',\n  ')}
}`}`;

  const chatSession = model.startChat({
    generationConfig,
    history: [],
  });

  let result = await chatSession.sendMessage(initialPrompt);
  let response;
  let fullObjectPath = objectPath;

  try {
    const parsedResponse = JSON.parse(result.response.text());
    
    if (needsKeyGeneration) {
      fullObjectPath = `${objectPath}.${parsedResponse.key}`;
      console.log(`Suggested key path: ${fullObjectPath}`);
      response = parsedResponse.translations;
    } else {
      response = parsedResponse;
    }
    
    // Validate that all required locales are present
    const hasAllLocales = locales.every(locale => 
      response.hasOwnProperty(locale) && typeof response[locale] === 'string'
    );

    if (!hasAllLocales) {
      // If validation fails, try again with a more forceful prompt
      const retryPrompt = `Your previous response was not properly formatted. Please provide translations in this EXACT format:
{
  ${locales.map(locale => `"${locale}": "translation in ${locale}"`).join(',\n  ')}
}
for this input: "${word}"${context ? ` with context: "${context}"` : ''}`;

      result = await chatSession.sendMessage(retryPrompt);
      response = JSON.parse(result.response.text());
    }
  } catch (error) {
    // If JSON parsing fails, try again with a more forceful prompt
    const retryPrompt = `Your previous response was not valid JSON. Please provide translations in this EXACT format:
{
  ${locales.map(locale => `"${locale}": "translation in ${locale}"`).join(',\n  ')}
}
for this input: "${word}"${context ? ` with context: "${context}"` : ''}`;

    result = await chatSession.sendMessage(retryPrompt);
    response = JSON.parse(result.response.text());
  }

  console.log(JSON.stringify(response, null, 2));

  // Update the files using the generated path
  for (const [locale, translation] of Object.entries(response)) {
    const messagePath = path.join(__dirname, `../src/messages/${locale}.json`);
    try {
      const messageFile = fs.readFileSync(messagePath, 'utf8');
      const messages = JSON.parse(messageFile);
      
      // Split the object path and traverse/create the nested structure
      const pathParts = fullObjectPath.split('.');
      let current = messages;
      
      // Create/traverse the nested objects except for the last part
      for (let i = 0; i < pathParts.length - 1; i++) {
        if (!current[pathParts[i]]) {
          current[pathParts[i]] = {};
        }
        current = current[pathParts[i]];
      }
      
      // Set the value at the final path
      current[pathParts[pathParts.length - 1]] = translation;
      
      fs.writeFileSync(messagePath, JSON.stringify(messages, null, 2));
      console.log(`Updated ${locale}.json`);
    } catch (error) {
      console.error(`Error updating ${locale}.json:`, error.message);
    }
  }
}
  
run();