require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const WA_VERSION = process.env.WHATSAPP_API_VERSION || "v23.0";
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const WA_VERIFY = process.env.WHATSAPP_VERIFY_TOKEN || "";
const WA_APP_SECRET = process.env.WHATSAPP_APP_SECRET || "";
const WA_AUTO = String(process.env.WHATSAPP_AUTO_REPLY || "false").toLowerCase() === "true";

app.use(cors());
app.use(express.json({limit:"1mb", verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf);}}));
app.use(express.static(path.join(__dirname,"public")));

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY}) : null;
function cleanJson(text){const value=String(text||"").trim();const match=value.match(/\{[\s\S]*\}/);return match?match[0]:value;}
async function askGemini(prompt){if(!ai) throw new Error("GEMINI_API_KEY manquante");const result=await ai.models.generateContent({model:MODEL,contents:prompt});return result.text||"";}

async function generateReply({conversation,goal="répondre naturellement",tone="naturel",language="français"}){
 if(!conversation||!String(conversation).trim()) throw new Error("Conversation vide.");
 const prompt=`Tu es Mon IA, un assistant de conversation.\nRéponds en ${language}. Ton: ${tone}. Objectif: ${goal}.\nContexte: ${conversation}\n\nProduis une réponse naturelle, courte et adaptée au contexte, sans manipulation, pression, mensonge, harcèlement ou spam. Si la personne refuse ou pose une limite, respecte-la. Pour une conversation de flirt, reste léger, respectueux et réciproque. Ne prétends jamais être l'utilisateur et n'invente pas de faits.\n\nRetourne UNIQUEMENT ce JSON valide:\n{"reply":"réponse principale","alternatives":["alternative 1","alternative 2"],"followUp":"question ou relance naturelle","reason":"courte explication du choix"}`;
 const raw=await askGemini(prompt);try{return JSON.parse(cleanJson(raw));}catch{return{reply:raw,alternatives:[],followUp:"",reason:"Réponse générée par Gemini."};}
}
function waConfigured(){return Boolean(WA_PHONE_ID&&WA_TOKEN&&WA_VERIFY);}
function verifySignature(req){if(!WA_APP_SECRET)return true;const sig=req.get("x-hub-signature-256")||"";if(!sig.startsWith("sha256=")||!req.rawBody)return false;const expected="sha256="+crypto.createHmac("sha256",WA_APP_SECRET).update(req.rawBody).digest("hex");try{return crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected));}catch{return false;}}
async function sendWhatsAppText(to,body){if(!waConfigured())throw new Error("WhatsApp Cloud API non configurée.");const r=await fetch(`https://graph.facebook.com/${WA_VERSION}/${WA_PHONE_ID}/messages`,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${WA_TOKEN}`},body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to,type:"text",text:{body:String(body).slice(0,4096)}})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`WhatsApp API: ${data?.error?.message||`HTTP ${r.status}`}`);return data;}
const seen=new Set();
async function processWebhook(payload){for(const entry of (payload?.entry||[])){for(const change of (entry?.changes||[])){if(change?.field!=="messages")continue;for(const message of (change?.value?.messages||[])){const id=message?.id;if(!id||seen.has(id))continue;seen.add(id);if(message?.type!=="text"||!message?.text?.body||!message?.from)continue;try{const result=await generateReply({conversation:`Message reçu sur WhatsApp:\n"${message.text.body}"`,goal:"répondre directement au message WhatsApp de façon utile et naturelle",tone:"naturel, amical et respectueux",language:"français"});if(WA_AUTO){await sendWhatsAppText(message.from,result.reply);console.log(`[WhatsApp] Réponse automatique envoyée à ${message.from}`);}else{console.log(`[WhatsApp] Suggestion pour ${message.from}: ${result.reply}`);}}catch(e){console.error("[WhatsApp] Traitement impossible:",e.message);}}}}}

app.get("/api/health",(req,res)=>res.json({ok:true,app:"Mon IA",version:"1.1.0",provider:ai?"gemini":"not-configured",model:MODEL,whatsapp:waConfigured()?"configured":"not-configured",whatsappAutoReply:WA_AUTO}));
app.get("/api/connectors",(req,res)=>res.json({success:true,connectors:[{id:"whatsapp",name:"WhatsApp",status:waConfigured()?"connecté":"à configurer",mode:WA_AUTO?"réponse automatique":"suggestions"},{id:"messenger",name:"Messenger",status:"préparation"},{id:"instagram",name:"Instagram",status:"préparation"},{id:"snapchat",name:"Snapchat",status:"préparation"}],note:"WhatsApp utilise l'API Cloud officielle de Meta et un webhook sécurisé."}));

app.get("/webhook/whatsapp",(req,res)=>{const mode=req.query["hub.mode"],token=req.query["hub.verify_token"],challenge=req.query["hub.challenge"];if(mode==="subscribe"&&WA_VERIFY&&token===WA_VERIFY)return res.status(200).send(String(challenge||""));return res.sendStatus(403);});
app.post("/webhook/whatsapp",async(req,res)=>{if(!verifySignature(req))return res.sendStatus(401);res.sendStatus(200);if(req.body?.object==="whatsapp_business_account")await processWebhook(req.body);});
app.get("/api/whatsapp/status",(req,res)=>res.json({success:true,configured:waConfigured(),apiVersion:WA_VERSION,phoneNumberIdConfigured:Boolean(WA_PHONE_ID),accessTokenConfigured:Boolean(WA_TOKEN),verifyTokenConfigured:Boolean(WA_VERIFY),appSecretConfigured:Boolean(WA_APP_SECRET),autoReply:WA_AUTO}));

app.post("/api/ai/reply",async(req,res)=>{try{const{conversation="",goal="répondre naturellement",tone="naturel",language="français",automatic=false}=req.body||{};const data=await generateReply({conversation,goal,tone,language});res.json({success:true,provider:"gemini",model:MODEL,automatic:!!automatic,...data});}catch(e){res.status(500).json({success:false,error:e.message||"Erreur Gemini"});}});
app.post("/api/ai/suggestions",async(req,res)=>{try{const{conversation="",tone="naturel",language="français"}=req.body||{};const data=await generateReply({conversation,goal:"proposer une réponse que l'utilisateur peut choisir avant envoi",tone,language});res.json({success:true,provider:"gemini",model:MODEL,automatic:false,...data});}catch(e){res.status(500).json({success:false,error:e.message||"Erreur Gemini"});}});
app.post("/api/ai/topics",async(req,res)=>{try{const{interests="",language="français"}=req.body||{};const raw=await askGemini(`Tu es Mon IA. Génère 5 sujets de conversation différents pour aujourd'hui en ${language}. Ils doivent aider deux personnes à mieux se connaître naturellement: goûts, musique, projets, souvenirs, voyages, humour ou valeurs. ${interests?"Centres d'intérêt explicitement mentionnés: "+interests:""} Ne déduis aucune information sensible. Retourne UNIQUEMENT un JSON valide: {"topics":["sujet 1","sujet 2","sujet 3","sujet 4","sujet 5"],"tip":"un conseil court"}`);let data;try{data=JSON.parse(cleanJson(raw));}catch{data={topics:[raw],tip:""};}res.json({success:true,provider:"gemini",model:MODEL,...data});}catch(e){res.status(500).json({success:false,error:e.message||"Erreur Gemini"});}});
app.post("/api/ai/profile",async(req,res)=>{try{const{conversation="",language="français"}=req.body||{};if(!conversation.trim())return res.status(400).json({success:false,error:"Conversation vide."});const raw=await askGemini(`Analyse uniquement les informations EXPLICITEMENT dites dans cette conversation. Langue de sortie: ${language}. Ne devine pas l'âge, la religion, la santé, l'origine, l'orientation, les opinions politiques ou tout autre attribut sensible. Donne des questions ouvertes pour mieux connaître la personne. Retourne UNIQUEMENT: {"interests":[],"knownFacts":[],"questionsToAsk":[]}\nConversation:\n${conversation}`);let data;try{data=JSON.parse(cleanJson(raw));}catch{data={interests:[],knownFacts:[],questionsToAsk:[raw]};}res.json({success:true,provider:"gemini",...data});}catch(e){res.status(500).json({success:false,error:e.message||"Erreur Gemini"});}});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Mon IA V1.1 démarré sur le port ${PORT}`));

