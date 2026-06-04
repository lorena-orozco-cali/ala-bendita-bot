require('dotenv').config()
const express = require('express')
const QRCode = require('qrcode')
const { connectToWhatsApp, sendMessage, getStatus, setMessageHandler } = require('./whatsapp')

const app = express()
app.use(express.json())

const sessions = new Map()
const ASESOR = process.env.ASESOR_JID || '573104672816@s.whatsapp.net'

const PRODUCTOS = {
  '1':  { nombre: '6 alitas + papas',       precio: 20000 },
  '2':  { nombre: '12 alitas + papas',      precio: 36000 },
  '3':  { nombre: '18 alitas + papas',      precio: 52000 },
  '4':  { nombre: '24 alitas + papas',      precio: 63000 },
  '5':  { nombre: '30 alitas + papas',      precio: 70000 },
  '6':  { nombre: 'Broaster x4 + papas',    precio: 28000 },
  '7':  { nombre: 'Broaster x8 + papas',    precio: 52000 },
  '8':  { nombre: 'Broaster con criollas',  precio: 18000 },
  '9':  { nombre: 'Bandeja mixta salsas',   precio: 36000 },
  '10': { nombre: 'Papas a la francesa',    precio: 7000  },
  '11': { nombre: 'Salchipapa',             precio: 9000  },
}

const SALSAS = ['BBQ', 'BBQ Picante', 'Miel Mostaza', 'Teriyaki', 'Chile Dulce', 'Apanadas']

const MENU = `🍗 *MENÚ ALA BENDITA CHICKEN* 🍗

*ALITAS + PAPAS A LA FRANCESA:*
1️⃣  6 alitas  → $20.000
2️⃣  12 alitas → $36.000
3️⃣  18 alitas → $52.000
4️⃣  24 alitas → $63.000
5️⃣  30 alitas → $70.000

*OTROS PRODUCTOS:*
6️⃣  Broaster x4 presas + papas → $28.000
7️⃣  Broaster x8 presas + papas → $52.000
8️⃣  Broaster con criollas → $18.000
9️⃣  Bandeja mixta salsas → $36.000
🔟  Papas a la francesa → $7.000
1️⃣1️⃣ Salchipapa → $9.000

Escribe el *número* del producto que quieres pedir 😊`

function fmt(n) {
  return '$' + n.toLocaleString('es-CO')
}

function getSession(jid) {
  if (!sessions.has(jid)) {
    sessions.set(jid, {
      step: 'inicio',
      pedido: [],
      nombre: '',
      direccion: '',
      pago: '',
      salsa: ''
    })
  }
  return sessions.get(jid)
}

async function handleMessage(jid, texto, hasMedia) {
  const s = getSession(jid)
  const txt = texto.trim()
  const lower = txt.toLowerCase()

  // Reinicio siempre disponible
  if (['menu', 'menú', 'inicio', 'reiniciar', 'cancelar', 'hola', 'buenas', 'buenos días', 'buenas tardes', 'buenas noches'].includes(lower)) {
    sessions.set(jid, { step: 'menu', pedido: [], nombre: '', direccion: '', pago: '', salsa: '' })
    await sendMessage(jid, `¡Hola! 👋 Bienvenido a *Ala Bendita Chicken* 🍗\n\n${MENU}`)
    return
  }

  if (s.step === 'inicio') {
    s.step = 'menu'
    await sendMessage(jid, `¡Hola! 👋 Bienvenido a *Ala Bendita Chicken* 🍗\n\n${MENU}`)
    return
  }

  if (s.step === 'menu') {
    const prod = PRODUCTOS[txt]
    if (!prod) {
      await sendMessage(jid, `Por favor escribe el *número* del producto del menú 👆\nEjemplo: *1* para 6 alitas`)
      return
    }
    s.pedido.push({ ...prod, cantidad: 1 })
    s.step = 'salsa'
    await sendMessage(jid, `Perfecto, anotado: *${prod.nombre}* 🍗\n\n¿Qué salsa prefieres?\n\n🍖 BBQ\n🌶️ BBQ Picante\n🍯 Miel Mostaza\n🫙 Teriyaki\n🍬 Chile Dulce\n⚪ Apanadas\n\nEscribe el nombre de la salsa 👇`)
    return
  }

  if (s.step === 'salsa') {
    s.salsa = txt
    s.step = 'mas_productos'
    await sendMessage(jid, `Salsa *${txt}* anotada ✅\n\n¿Deseas agregar algo más?\n\n${MENU}\n\nO escribe *listo* para continuar con tu pedido 👇`)
    return
  }

  if (s.step === 'mas_productos') {
    if (lower === 'listo' || lower === 'no' || lower === 'nada mas' || lower === 'nada más') {
      s.step = 'nombre'
      await sendMessage(jid, `¡Perfecto! ¿Cuál es tu nombre? 😊`)
      return
    }
    const prod = PRODUCTOS[txt]
    if (prod) {
      s.pedido.push({ ...prod, cantidad: 1 })
      await sendMessage(jid, `Agregado: *${prod.nombre}* ✅\n\n¿Algo más? Escribe otro número o escribe *listo* para continuar 👇`)
    } else {
      await sendMessage(jid, `No entendí. Escribe el *número* del producto o escribe *listo* para continuar 👇`)
    }
    return
  }

  if (s.step === 'nombre') {
    s.nombre = txt
    s.step = 'direccion'
    await sendMessage(jid, `Mucho gusto *${txt}* 😊\n\n¿Cuál es tu dirección de entrega? 🏠\n(Incluye barrio y ciudad)`)
    return
  }

  if (s.step === 'direccion') {
    s.direccion = txt
    s.step = 'pago'
    await sendMessage(jid, `Dirección anotada ✅\n\n¿Cómo vas a pagar?\n\n💵 *Efectivo*\n📱 *Nequi*\n🏦 *Transferencia*`)
    return
  }

  if (s.step === 'pago') {
    s.pago = txt
    s.step = 'confirmacion'

    const total = s.pedido.reduce((acc, p) => acc + p.precio, 0)
    const resumen = s.pedido.map(p => `• ${p.nombre} — ${fmt(p.precio)}`).join('\n')

    const resumenMsg = `📋 *RESUMEN DE TU PEDIDO*\n\n${resumen}\n🥫 Salsa: ${s.salsa}\n\n💰 *TOTAL: ${fmt(total)}*\n\n📍 Dirección: ${s.direccion}\n💳 Pago: ${s.pago}\n\n¿Confirmas tu pedido? Escribe *sí* o *no* 👇`

    await sendMessage(jid, resumenMsg)
    return
  }

  if (s.step === 'confirmacion') {
    if (lower === 'si' || lower === 'sí' || lower === 'confirmo' || lower === 'ok' || lower === 'dale') {
      const total = s.pedido.reduce((acc, p) => acc + p.precio, 0)
      const resumen = s.pedido.map(p => `• ${p.nombre} — ${fmt(p.precio)}`).join('\n')

      // Mensaje al cliente
      await sendMessage(jid, `✅ *¡Pedido confirmado!*\n\n🍗 Tu pedido está en preparación.\n⏱️ Tiempo estimado: 30-45 minutos\n\n¡Gracias por elegir *Ala Bendita Chicken*! 🙏`)

      // Comanda al asesor
      const comanda = `🔔 *NUEVO PEDIDO - ALA BENDITA*\n\n👤 Cliente: ${s.nombre}\n📱 WhatsApp: ${jid.replace('@s.whatsapp.net','')}\n\n📋 *PEDIDO:*\n${resumen}\n🥫 Salsa: ${s.salsa}\n\n💰 *TOTAL: ${fmt(total)}*\n📍 Dirección: ${s.direccion}\n💳 Pago: ${s.pago}`
      await sendMessage(ASESOR, comanda)

      sessions.delete(jid)
    } else if (lower === 'no') {
      sessions.set(jid, { step: 'menu', pedido: [], nombre: '', direccion: '', pago: '', salsa: '' })
      await sendMessage(jid, `Pedido cancelado. Escribe *menú* cuando quieras volver a pedir 😊`)
    } else {
      await sendMessage(jid, `Por favor escribe *sí* para confirmar o *no* para cancelar 👇`)
    }
    return
  }
}

// Rutas Express
app.get('/', (req, res) => {
  const s = getStatus()
  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
    <h1>🍗 Ala Bendita Bot</h1>
    <p>Estado: <b>${s.status}</b></p>
    ${s.status !== 'connected' ? '<p><a href="/qr">Ver QR para conectar</a></p>' : '<p style="color:green">✅ Conectado y funcionando</p>'}
  </body></html>`)
})

app.get('/qr', async (req, res) => {
  const s = getStatus()
  if (s.status === 'connected') {
    return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h1>✅ Bot ya conectado</h1></body></html>')
  }
  if (!s.qr) {
    return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h1>⏳ Generando QR...</h1><p>Espera 10 segundos y recarga</p><script>setTimeout(()=>location.reload(),5000)</script></body></html>')
  }
  const qrImg = await QRCode.toDataURL(s.qr)
  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
    <h1>📱 Escanea con WhatsApp</h1>
    <img src="${qrImg}" style="width:300px;height:300px"/>
    <p>Abre WhatsApp → tres puntos → Dispositivos vinculados → Vincular dispositivo</p>
    <script>setTimeout(()=>location.reload(),30000)</script>
  </body></html>`)
})

app.get('/status', (req, res) => res.json(getStatus()))

const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`)
  setMessageHandler(handleMessage)
  await connectToWhatsApp()
})
