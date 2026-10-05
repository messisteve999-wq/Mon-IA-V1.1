# Mise à jour WhatsApp Cloud + Gemini pour Mon IA V1.1

Remplacez `server.js`, `.env.example` et `render.yaml` de votre projet actuel par ceux de ce dossier.

Variables Render:
- GEMINI_API_KEY
- GEMINI_MODEL
- WHATSAPP_API_VERSION=v23.0
- WHATSAPP_PHONE_NUMBER_ID
- WHATSAPP_ACCESS_TOKEN
- WHATSAPP_VERIFY_TOKEN
- WHATSAPP_APP_SECRET
- WHATSAPP_AUTO_REPLY=false

Webhook Meta:
https://mon-ia-v1-1.onrender.com/webhook/whatsapp

Dans Meta, utilisez exactement la valeur de WHATSAPP_VERIFY_TOKEN comme Verify Token.
Abonnez le webhook au champ `messages`.

Pour activer les réponses automatiques après les tests:
WHATSAPP_AUTO_REPLY=true

Le token Gemini et les tokens Meta restent côté serveur et ne doivent pas être mis dans `public/` ou dans GitHub.

Le serveur répond aux messages texte entrants. Les messages non texte sont ignorés pour cette première intégration.
Pour les messages hors fenêtre de service client, WhatsApp peut exiger un template approuvé.
