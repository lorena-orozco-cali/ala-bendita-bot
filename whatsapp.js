const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const { MongoClient } = require('mongodb')
const pino = require('pino')
const fs = require('fs')
const path = require('path')

let sock = null
let currentQR = null
let connectionStatus = 'disconnected'
let messageHandler = null

const MONGO_URI = process.env.MONGO_URI
const SESSION_PATH = '/tmp/baileys_session'

async function saveSessionToMongo(sessionPath) {
  if (!MONGO_URI) return
  const client = new MongoClient(MONGO_URI)
  try {
    await client.connect()
    const db = client.db('alabendita')
    const col = db.collection('session')
    if (!fs.existsSync(sessionPath)) return
    const files = fs.readdirSync(sessionPath)
    for (const file of files) {
      const content = fs.readFileSync(path.join(sessionPath, file), 'utf8')
      await col.updateOne({ _id: file }, { $set: { content } }, { upsert: true })
    }
  } catch(e) {
    console.log('Error guardando sesión:', e.message)
  } finally {
    await client.close()
  }
}

async function loadSessionFromMongo(sessionPath) {
  if (!MONGO_URI) return false
  const client = new MongoClient(MONGO_URI)
  try {
    await client.connect()
    const db = client.db('alabendita')
    const col = db.collection('session')
    const docs = await col.find({}).toArray()
    if (docs.length === 0) return false
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true })
    for (const doc of docs) {
      fs.writeFileSync(path.join(sessionPath, doc._id), doc.content)
    }
    return true
  } catch(e) {
    console.log('Error cargando sesión:', e.message)
    return false
  } finally {
    await client.close()
  }
}

function getStatus() {
  return { status: connectionStatus, qr: currentQR }
}

function setMessageHandler(handler) {
  messageHandler = handler
}

async function connectToWhatsApp() {
  try {
    await loadSessionFromMongo(SESSION_PATH)
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH)
    const { version } = await fetchLatestBaileysVersion()

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,
      browser: ['Ala Bendita Bot', 'Chrome', '1.0.0'],
    })

    sock.ev.on('creds.update', async () => {
      await saveCreds()
      await saveSessionToMongo(SESSION_PATH)
    })

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
  } catch(e) {
    console.log('Error conectando:', e.message)
    setTimeout(connectToWhatsApp, 5000)
  }
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
