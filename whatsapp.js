const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const path = require('path')
const pino = require('pino')

let sock = null
let currentQR = null
let connectionStatus = 'disconnected'
let messageHandler = null

const SESSION_PATH = process.env.SESSION_PATH || './session'

function getStatus() {
  return { status: connectionStatus, qr: currentQR }
}

function setMessageHandler(handler) {
  messageHandler = handler
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH)
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['Ala Bendita Bot', 'Chrome', '1.0.0'],
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      currentQR = qr
      connectionStatus = 'qr_ready'
      console.log('📱 QR listo — ve a /qr para escanearlo')
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
        : true
      connectionStatus = 'disconnected'
      console.log('❌ Conexión cerrada, reconectando:', shouldReconnect)
      if (shouldReconnect) setTimeout(connectToWhatsApp, 5000)
    }
    if (connection === 'open') {
      currentQR = null
      connectionStatus = 'connected'
      console.log('✅ WhatsApp conectado')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue
      const jid = msg.key.remoteJid
      if (!jid || jid.includes('broadcast') || jid.includes('status')) continue
      const texto = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption
        || ''
      const hasMedia = !!(msg.message?.imageMessage || msg.message?.documentMessage)
      try {
        if (messageHandler) await messageHandler(jid, texto, hasMedia)
      } catch (e) {
        console.error('Error en mensaje:', e.message)
      }
    }
  })
}

async function sendMessage(jid, text) {
  if (!sock) return
  try {
    await sock.sendMessage(jid, { text })
  } catch (e) {
    console.error('Error enviando mensaje:', e.message)
  }
}

module.exports = { connectToWhatsApp, sendMessage, getStatus, setMessageHandler }
