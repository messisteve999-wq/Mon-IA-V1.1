require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

app.use(cors());
app.use(express.json({
  limit: "1mb",
  verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); }
}));
app.use(express.static(path.join(__dirname, "public")));

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const processedMessages = new Set();

const bool = (v, fallback = false) => v == null ? fallback : ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
const whatsappAuto = bool(process.env.WHATSAPP_AUTO_REPLY, false);
const messengerAuto = bool(process.env.MESSENGER_AUTO_REPLY, false);

function cleanJson(text) {
  const value = String(text || "").trim();
  const match = value.match(/\{[\s\S]*\}/);
  return match ? match[0] : value;
}

async function askGemini(prompt) {
  if (!ai) throw new Error("GEMINI_API_KEY manquante");
  const result = await ai.models.generateContent({ model: MODEL, contents: prompt });
  return result.text || "";
}

async function generateConversationReply({ conversation, platform = "messagerie", goal = "répondre naturellement", language = "français" }) {
  const prompt = `Tu es Steve, l'assistant conversationnel de Mon IA. Tu aides l'utilisateur à répondre à des messages reçus sur ${platform}.
Objectif: ${goal}. Langue: ${language}.
Conversation:
${conversation}

Produis une réponse naturelle et concise. Tu peux relancer avec une question ouverte ou proposer un sujet si cela correspond au contexte.
Respecte les limites exprimées par l'interlocuteur. Ne manipule pas, ne harcèle pas, ne spamme pas, ne mens pas et ne prétends pas être une autre personne.
Retourne UNIQUEMENT ce JSON valide:
{"reply":"...","followUp":"...","topics":["...","..."],"reason":"..."}`;
  const raw = await askGemini(prompt);
  try { return JSON.parse(cleanJson(raw)); }
  catch { return { reply: raw, followUp: "", topics: [], reason: "Réponse générée par Gemini." }; }
}

function verifyMetaSignature(req, secret) {
  if (!secret) return true;
  const header = req.get("x-hub-signature-256") || "";
  if (!header.startsWith("sha256=") || !req.rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected)); }
  catch { return false; }
}

function whatsappConfigured() {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_VERIFY_TOKEN);
}
function messengerConfigured() {
  return !!(process.env.MESSENGER_PAGE_ID && process.env.MESSENGER_PAGE_ACCESS_TOKEN && process.env.MESSENGER_VERIFY_TOKEN);
}

async function sendWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: String(body).slice(0, 4096) } })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${data?.error?.message || JSON.stringify(data)}`);
  return data;
}

async function sendMessengerText(recipientId, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/me/messages?access_token=${encodeURIComponent(process.env.MESSENGER_PAGE_ACCESS_TOKEN)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: String(body).slice(0, 2000) } })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Messenger ${r.status}: ${data?.error?.message || JSON.stringify(data)}`);
  return data;
}

async function handleWhatsApp(payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        if (!message?.id || processedMessages.has(message.id)) continue;
        processedMessages.add(message.id);
        if (message.type !== "text" || !message.text?.body) continue;
        const from = message.from;
        const result = await generateConversationReply({ conversation: message.text.body, platform: "WhatsApp" });
        if (whatsappAuto) await sendWhatsAppText(from, result.reply);
        console.log(`[WhatsApp] ${from}: ${message.text.body} -> ${whatsappAuto ? result.reply : "suggestion seulement"}`);
      }
    }
  }
}

async function handleMessenger(payload) {
  for (const entry of payload.entry || []) {
    for (const event of entry.messaging || []) {
      const sender = event.sender?.id;
      const text = event.message?.text;
      const id = event.message?.mid;
      if (!sender || !text || !id || processedMessages.has(id)) continue;
      processedMessages.add(id);
      if (event.message?.is_echo) continue;
      const result = await generateConversationReply({ conversation: text, platform: "Facebook Messenger" });
      if (messengerAuto) await sendMessengerText(sender, result.reply);
      console.log(`[Messenger] ${sender}: ${text} -> ${messengerAuto ? result.reply : "suggestion seulement"}`);
    }
  }
}

app.get("/api/health", (req, res) => res.json({
  ok: true, app: "Mon IA", version: "1.2.0", provider: ai ? "gemini" : "not-configured", model: MODEL,
  whatsapp: whatsappConfigured() ? "configured" : "not-configured", whatsappAutoReply: whatsappAuto,
  messenger: messengerConfigured() ? "configured" : "not-configured", messengerAutoReply: messengerAuto
}));

app.get("/api/connectors", (req, res) => res.json({ success: true, connectors: [
  { id: "whatsapp", name: "WhatsApp", status: whatsappConfigured() ? "connecté" : "à configurer", mode: whatsappAuto ? "automatique" : "suggestions" },
  { id: "messenger", name: "Facebook Messenger", status: messengerConfigured() ? "connecté" : "à configurer", mode: messengerAuto ? "automatique" : "suggestions" },
  { id: "facebook", name: "Facebook Pages", status: messengerConfigured() ? "via Messenger" : "à configurer" },
  { id: "instagram", name: "Instagram", status: "à configurer" },
  { id: "snapchat", name: "Snapchat", status: "non intégré" }
], note: "Les comptes personnels ne sont pas synchronisés par lecture de notifications. Les plateformes doivent autoriser l'accès via leurs APIs officielles." }));

app.get("/api/whatsapp/status", (req, res) => res.json({ configured: whatsappConfigured(), autoReply: whatsappAuto, phoneNumberIdConfigured: !!process.env.WHATSAPP_PHONE_NUMBER_ID, accessTokenConfigured: !!process.env.WHATSAPP_ACCESS_TOKEN, verifyTokenConfigured: !!process.env.WHATSAPP_VERIFY_TOKEN, appSecretConfigured: !!process.env.WHATSAPP_APP_SECRET }));
app.get("/api/messenger/status", (req, res) => res.json({ configured: messengerConfigured(), autoReply: messengerAuto, pageIdConfigured: !!process.env.MESSENGER_PAGE_ID, pageAccessTokenConfigured: !!process.env.MESSENGER_PAGE_ACCESS_TOKEN, verifyTokenConfigured: !!process.env.MESSENGER_VERIFY_TOKEN, appSecretConfigured: !!process.env.MESSENGER_APP_SECRET }));

app.post("/api/ai/reply", async (req, res) => {
  try {
    const { conversation = "", goal = "répondre naturellement", tone = "naturel", language = "français", platform = "messagerie", automatic = false } = req.body || {};
    if (!conversation.trim()) return res.status(400).json({ success: false, error: "Conversation vide." });
    const result = await generateConversationReply({ conversation: `${conversation}\nTon: ${tone}`, platform, goal, language });
    res.json({ success: true, provider: "gemini", model: MODEL, automatic: !!automatic, ...result });
  } catch (error) { res.status(500).json({ success: false, error: error.message || "Erreur Gemini" }); }
});

app.post("/api/ai/suggestions", async (req, res) => {
  try {
    const { conversation = "", language = "français" } = req.body || {};
    if (!conversation.trim()) return res.status(400).json({ success: false, error: "Conversation vide." });
    const result = await generateConversationReply({ conversation, language, platform: "messagerie", goal: "proposer plusieurs façons naturelles de poursuivre la conversation" });
    res.json({ success: true, provider: "gemini", ...result });
  } catch (error) { res.status(500).json({ success: false, error: error.message || "Erreur Gemini" }); }
});

app.post("/api/ai/topics", async (req, res) => {
  try {
    const { interests = "", language = "français" } = req.body || {};
    const raw = await askGemini(`Génère 5 sujets de conversation naturels en ${language}. Centres d'intérêt explicites: ${interests || "aucun"}. Ne déduis aucune information sensible. Retourne uniquement {"topics":["...","...","...","...","..."],"tip":"..."}`);
    let data; try { data = JSON.parse(cleanJson(raw)); } catch { data = { topics: [raw], tip: "" }; }
    res.json({ success: true, provider: "gemini", model: MODEL, ...data });
  } catch (error) { res.status(500).json({ success: false, error: error.message || "Erreur Gemini" }); }
});

app.post("/api/ai/profile", async (req, res) => {
  try {
    const { conversation = "", language = "français" } = req.body || {};
    if (!conversation.trim()) return res.status(400).json({ success: false, error: "Conversation vide." });
    const raw = await askGemini(`Analyse uniquement les informations explicitement dites dans cette conversation. Langue: ${language}. Ne devine aucun attribut sensible. Retourne {"interests":[],"knownFacts":[],"questionsToAsk":[]}. Conversation:\n${conversation}`);
    let data; try { data = JSON.parse(cleanJson(raw)); } catch { data = { interests: [], knownFacts: [], questionsToAsk: [raw] }; }
    res.json({ success: true, provider: "gemini", ...data });
  } catch (error) { res.status(500).json({ success: false, error: error.message || "Erreur Gemini" }); }
});

function metaVerify(req, res, token) {
  const mode = req.query["hub.mode"];
  const verify = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && verify && challenge && verify === token) return res.status(200).send(challenge);
  return res.sendStatus(403);
}

app.get("/webhook/whatsapp", (req, res) => metaVerify(req, res, process.env.WHATSAPP_VERIFY_TOKEN));
app.post("/webhook/whatsapp", (req, res) => {
  if (!verifyMetaSignature(req, process.env.WHATSAPP_APP_SECRET)) return res.sendStatus(403);
  res.sendStatus(200);
  handleWhatsApp(req.body).catch(err => console.error("WhatsApp webhook:", err.message));
});

app.get("/webhook/messenger", (req, res) => metaVerify(req, res, process.env.MESSENGER_VERIFY_TOKEN));
app.post("/webhook/messenger", (req, res) => {
  if (!verifyMetaSignature(req, process.env.MESSENGER_APP_SECRET)) return res.sendStatus(403);
  res.sendStatus(200);
  handleMessenger(req.body).catch(err => console.error("Messenger webhook:", err.message));
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Mon IA V1.2 démarré sur le port ${PORT}`));
