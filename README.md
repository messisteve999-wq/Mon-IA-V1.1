# Mon IA V1.2 — Steve

Assistant conversationnel Gemini avec architecture de connecteurs officiels.

## Inclus
- Gemini pour générer des réponses et des relances.
- PWA installable avec logo Steve.
- WhatsApp Cloud API: webhook + envoi de texte + mode automatique/suggestions.
- Facebook Pages / Messenger: webhook + réponse texte + mode automatique/suggestions.
- Endpoints de statut et de santé.
- Instagram préparé comme connecteur futur.
- Snapchat indiqué comme non intégré tant qu'un accès API officiel adapté n'est pas configuré.

## Webhooks Render
- WhatsApp: `https://VOTRE-DOMAINE/webhook/whatsapp`
- Messenger: `https://VOTRE-DOMAINE/webhook/messenger`

## Variables
Voir `.env.example` et `render.yaml`. Ne jamais mettre les tokens dans GitHub, le frontend ou le ZIP.

## Test local
```bash
npm install
cp .env.example .env
npm start
```
Puis: `curl -s http://127.0.0.1:3000/api/health`

## Déploiement Render
Le service est un Node web service. Configure les secrets dans Render. Commence avec `WHATSAPP_AUTO_REPLY=false` et `MESSENGER_AUTO_REPLY=false` pour vérifier les webhooks et les suggestions, puis active l'automatisation après test.

Les réponses automatiques passent uniquement par les APIs officielles et leurs autorisations. Les comptes personnels ne sont pas synchronisés par lecture de notifications.
