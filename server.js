require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const GRAPH = process.env.META_GRAPH_VERSION || "v23.0";
app.use(cors());
app.use(express.json({limit:"1mb", verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf)}}));
app.use(express.static(path.join(__dirname,"public")));

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY}) : null;
const chats = new Map();
const processed = new Set();
const enabled = v => ["1","true","yes","on"].includes(String(v||"").toLowerCase());
const autoReply = () => enabled(process.env.WHATSAPP_AUTO_REPLY);
const whatsappReady = () => !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_VERIFY_TOKEN);

function getChat(id) {
  if (!chats.has(id)) chats.set(id,{id,name:id,platform:"WhatsApp",messages:[],updatedAt:new Date().toISOString()});
  return chats.get(id);
}
function auth(req,res,next) {
  const key=process.env.DASHBOARD_ACCESS_KEY;
  if(!key) return res.status(503).json({success:false,error:"Configure DASHBOARD_ACCESS_KEY dans Render."});
  if(req.get("x-dashboard-key")!==key) return res.status(401).json({success:false,error:"Clé du tableau de bord incorrecte."});
  next();
}
function verifySignature(req) {
  const secret=process.env.WHATSAPP_APP_SECRET;
  if(!secret) return true;
  const header=req.get("x-hub-signature-256")||"";
  if(!header.startsWith("sha256=")) return false;
  const expected="sha256="+crypto.createHmac("sha256",secret).update(req.rawBody||Buffer.alloc(0)).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(header),Buffer.from(expected)); } catch { return false; }
}
async function askGemini(prompt) {
  if(!ai) throw new Error("GEMINI_API_KEY manquante");
  const result=await ai.models.generateContent({model:MODEL,contents:prompt});
  return result.text||"";
}
function jsonFrom(text) {
  const match=String(text||"").match(/\{[\s\S]*\}/);
  return match?match[0]:String(text||"");
}
async function generateReply(conversation,tone="naturel") {
  const prompt=`Tu es Steve, l'assistant conversationnel de Mon IA. Réponds en français, naturellement et avec concision. Ton: ${tone}. Tiens compte du contexte. Respecte les limites de l'interlocuteur. Ne manipule pas, ne harcèle pas, ne mens pas et ne spamme pas.
Retourne uniquement ce JSON valide: {"reply":"...","followUp":"...","topics":["...","..."],"reason":"..."}
Conversation:\n${conversation}`;
  const raw=await askGemini(prompt);
  try { return JSON.parse(jsonFrom(raw)); }
  catch { return {reply:raw,followUp:"",topics:[],reason:"Réponse générée par Gemini."}; }
}
async function sendWhatsApp(to,body) {
  const url=`https://graph.facebook.com/${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to,type:"text",text:{body:String(body).slice(0,4096)}})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error?.message||`Erreur WhatsApp ${response.status}`);
  return data;
}

app.get("/api/health",(req,res)=>res.json({ok:true,app:"Mon IA",version:"3.0.0",provider:ai?"gemini":"not-configured",model:MODEL,whatsapp:whatsappReady()?"configured":"not-configured",autoReply:autoReply(),dashboardKeyRequired:true}));
app.get("/api/whatsapp/status",(req,res)=>res.json({configured:whatsappReady(),autoReply:autoReply(),phoneNumberIdConfigured:!!process.env.WHATSAPP_PHONE_NUMBER_ID,accessTokenConfigured:!!process.env.WHATSAPP_ACCESS_TOKEN,verifyTokenConfigured:!!process.env.WHATSAPP_VERIFY_TOKEN,appSecretConfigured:!!process.env.WHATSAPP_APP_SECRET}));
app.post("/api/ai/reply",async(req,res)=>{try{const result=await generateReply(req.body?.conversation||"",req.body?.tone||"naturel");res.json({success:true,...result});}catch(e){res.status(500).json({success:false,error:e.message});}});

app.get("/api/chats",auth,(req,res)=>res.json({success:true,chats:[...chats.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(c=>({...c,lastMessage:c.messages.at(-1)?.text||""}))}));
app.get("/api/chats/:id",auth,(req,res)=>{const c=chats.get(req.params.id);if(!c)return res.status(404).json({success:false,error:"Conversation introuvable"});res.json({success:true,chat:c});});
app.post("/api/chats/:id/suggest",auth,async(req,res)=>{try{const c=chats.get(req.params.id);if(!c)return res.status(404).json({success:false,error:"Conversation introuvable"});const context=c.messages.slice(-20).map(m=>(m.direction==="in"?"Contact":"Steve")+": "+m.text).join("\n");const result=await generateReply(context,req.body?.tone||"naturel");res.json({success:true,...result});}catch(e){res.status(500).json({success:false,error:e.message});}});
app.post("/api/chats/:id/send",auth,async(req,res)=>{try{const c=chats.get(req.params.id);if(!c)return res.status(404).json({success:false,error:"Conversation introuvable"});const body=String(req.body?.text||"").trim();if(!body)return res.status(400).json({success:false,error:"Message vide"});if(!whatsappReady())return res.status(400).json({success:false,error:"WhatsApp n'est pas configuré"});const sent=await sendWhatsApp(c.id,body);const message={id:sent.messages?.[0]?.id||crypto.randomUUID(),direction:"out",text:body,time:new Date().toISOString(),status:"sent"};c.messages.push(message);c.updatedAt=message.time;res.json({success:true,message});}catch(e){res.status(502).json({success:false,error:e.message});}});

app.get("/webhook/whatsapp",(req,res)=>{const q=req.query;if(q["hub.mode"]==="subscribe"&&q["hub.verify_token"]===process.env.WHATSAPP_VERIFY_TOKEN&&q["hub.challenge"])return res.status(200).send(q["hub.challenge"]);res.sendStatus(403);});
app.post("/webhook/whatsapp",(req,res)=>{if(!verifySignature(req))return res.sendStatus(403);res.sendStatus(200);(async()=>{for(const entry of req.body.entry||[])for(const change of entry.changes||[])for(const msg of change.value?.messages||[]){if(!msg.id||processed.has(msg.id)||msg.type!=="text")continue;processed.add(msg.id);const c=getChat(msg.from);const incoming={id:msg.id,direction:"in",text:msg.text?.body||"",time:new Date().toISOString(),status:"received"};c.messages.push(incoming);c.updatedAt=incoming.time;if(autoReply()&&ai&&whatsappReady()){const context=c.messages.slice(-20).map(m=>(m.direction==="in"?"Contact":"Steve")+": "+m.text).join("\n");const answer=await generateReply(context);const sent=await sendWhatsApp(msg.from,answer.reply);const outgoing={id:sent.messages?.[0]?.id||crypto.randomUUID(),direction:"out",text:answer.reply,time:new Date().toISOString(),status:"sent"};c.messages.push(outgoing);c.updatedAt=outgoing.time;}}})().catch(e=>console.error("Webhook WhatsApp:",e.message));});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Mon IA V3 démarré sur le port ${PORT}`));
