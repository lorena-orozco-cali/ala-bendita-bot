const { Client, LocalAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode')
const express = require('express')

let client = null
let currentQR = null
let connectionStatus = 'disconnected'
let messageHandler = null

function getStatus() {
  return { status: connectionStatus, qr: currentQR }
}

function setMessageHandler(handler) {
  messageHandler = handler
}

async function connectToWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/tmp/wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  })

  client.on('qr', (qr) => {
    currentQR = qr
    connectionStatus = 'qr_ready'
    console.log('📱 QR listo')
  })

  client.on('ready', () => {
    currentQR = null
    connectionStatus = 'connected'
    console.log('✅ WhatsApp conectado')
  })

  client.on('disconnected', () => {
    connectionStatus = 'disconnected'
    console.log('❌ Desconectado, reconectando...')
    setTimeout(connectToWhatsApp, 5000)
  })

  client.on('message', async (msg) => {
    try {
      if (messageHandler) await messageHandler(msg.from, msg.body, false)
    } catch(e) {
      console.error('Error mensaje:', e.message)
    }
  })

  await client.initialize()
}

async function sendMessage(jid, text) {
  if (!client) return
  try {
    await client.sendMessage(jid, text)
  } catch(e) {
    console.error('Error enviando:', e.message)
  }
}

module.exports = { connectToWhatsApp, sendMessage, getStatus, setMessageHandler }
