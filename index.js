require('dotenv').config()
const express = require('express')
const QRCode = require('qrcode')

const { connectToWhatsApp, sendMessage, getStatus, setMessageHandler } = require('./whatsapp')

const app = express()
app.use(express.json())

const sessions = new Map()

const STATES = {
  MENU: 'MENU',
  ESPERANDO_NOMBRE: 'ESPERANDO_NOMBRE',
  ESPERANDO_ITEMS: 'ESPERANDO_ITEMS',
  ESPERANDO_SALSA: 'ESPERANDO_SALSA',
  ESPERANDO_DIRECCION: 'ESPERANDO_DIRECCION',
  ESPERANDO_PAGO: 'ESPERANDO_PAGO',
  ESPERANDO_COMPROBANTE: 'ESPERANDO_COMPROBANTE',
}

const MENU_MSG = `🍗 *MENÚ ALA BENDITA CHICKEN* 🍗

*ALITAS + PAPAS A LA FRANCESA:*
1️⃣  6 alitas  → $20.000
2️⃣  12 alitas → $36.000
3️⃣  18 alitas → $52.000
4️⃣  24 alitas → $63.000
5️⃣  30 alitas → $70.000

*SALSAS DISPONIBLES:*
🍖 BBQ · 🌶️ BBQ Picante · 🍯 Miel Mostaza
🫙 Teriyaki · 🍬 Chile Dulce · ⚪ Apanadas

*OTROS PRODUCTOS:*
🍖 Broaster x4 presas + papas → $28.000
🍗 Broaster x8 presas + papas → $52.000
🍗 Broaster con criollas → $18.000
🥘 Bandeja mixta salsas → $36.000
🍟 Papas a la francesa → $7.000
🌭 Salchipapa → $9.000

🛵 *DOMICILIO GRATIS* sur de Cali
⏰ Horario: 4pm - 11pm todos los días
💳 Efectivo · Nequi · Transferencias`

const BIENVENIDA = `¡Hola! 👋 Bienvenido a *Ala Bendita Chicken* 🍗

¿Qué deseas hacer?

1️⃣ Ver el menú
2️⃣ Hacer un pedido
3️⃣ Hablar con un asesor
4️⃣ Información (zonas, horario, pago)

Responde con el número 😊`

function getSession(jid) {
  if (!sessions.has(jid)) sessions.set(jid, { state: STATES.MENU, pedido: { items: [], nombre: '', direccion: '', pago: '' } })
  return sessions.get(jid)
}

function setSession(jid, data) {
  sessions.set(jid, { ...getSession(jid), ...data })
}

function detectarSalsa(t) {
  if (t.includes('picante')) return 'BBQ Picante'
  if (t.includes('miel') || t.includes('mostaza')) return 'Miel Mostaza'
  if (t.includes('teriyaki')) return 'Teriyaki'
  if (t.includes('chile')) return 'Chile Dulce'
  if (t.includes('apanada') || t.includes('sin salsa')) return 'Apanadas'
  return 'BBQ'
}

function generarComanda(jid) {
  const session = getSession(jid)
  const p = session.pedido
  const now = new Date()
  const hora = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  const fecha = now.toLocaleDateString('es-CO')
  let total = 0
  let items = ''
  p.items.forEach(it => {
    total += it.precio
    items += `• ${it.nombre} → $${it.precio.toLocaleString('es-CO')}\n`
  })
  return `════════════════════════════\n🍗 *ALA BENDITA CHICKEN*\n════════════════════════════\n📅 ${fecha} ⏰ ${hora}\n👤 ${p.nombre}\n📞 ${jid.replace('@s.whatsapp.net', '')}\n────────────────────────────\n${items}────────────────────────────\n💰 *TOTAL: $${total.toLocaleString('es-CO')}*\n📍 ${p.direccion}\n💳 ${p.pago}\n════════════════════════════\n🛵 DOMICILIO GRATIS · SUR CALI`
}

async function handleMessage(jid, texto, hasMedia) {
  const t = (texto || '').trim().toLowerCase()
  const session = getSession(jid)
  const owners = (process.env.OWNER_NUMBERS || '').split(',').filter(Boolean)

  // ESTADOS ACTIVOS DEL FLUJO

  if (session.state === STATES.ESPERANDO_NOMBRE) {
    setSession(jid, { state: STATES.ESPERANDO_ITEMS, pedido: { ...session.pedido, nombre: texto.trim(), items: [] } })
    await sendMessage(jid, `Hola *${texto.trim()}* 😊\n\n${MENU_MSG}\n\nEscríbeme qué quieres. Ejemplo:\n_"12 alitas bbq"_\n_"6 alitas miel mostaza"_\n_"broaster x4"_\n\nCuando termines escribe *listo* ✅`)
    return
  }

  if (session.state === STATES.ESPERANDO_ITEMS) {
    if (t === 'listo' || t === 'es todo' || t === 'eso es todo') {
      if (session.pedido.items.length === 0) {
        await sendMessage(jid, `No has agregado nada aún 😅\nDime qué quieres pedir 🍗`)
        return
      }
      setSession(jid, { state: STATES.ESPERANDO_DIRECCION })
      let resumen = `✅ *Tu pedido:*\n\n`
      let total = 0
      session.pedido.items.forEach(it => { resumen += `• ${it.nombre}\n`; total += it.precio })
      resumen += `\n💰 *Total: $${total.toLocaleString('es-CO')}*`
      await sendMessage(jid, resumen)
      await sendMessage(jid, `¿Cuál es tu *dirección* de entrega? 📍`)
      return
    }

    let agregado = false
    const salsa = detectarSalsa(t)
    const items = [...session.pedido.items]

    if (t.includes('6 alita') || t.includes('seis alita')) { items.push({ nombre: `6 Alitas + Papas (${salsa})`, precio: 20000 }); agregado = true }
    else if (t.includes('12 alita') || t.includes('doce alita')) { items.push({ nombre: `12 Alitas + Papas (${salsa})`, precio: 36000 }); agregado = true }
    else if (t.includes('18 alita') || t.includes('dieciocho')) { items.push({ nombre: `18 Alitas + Papas (${salsa})`, precio: 52000 }); agregado = true }
    else if (t.includes('24 alita') || t.includes('veinticuatro')) { items.push({ nombre: `24 Alitas + Papas (${salsa})`, precio: 63000 }); agregado = true }
    else if (t.includes('30 alita') || t.includes('treinta')) { items.push({ nombre: `30 Alitas + Papas (${salsa})`, precio: 70000 }); agregado = true }
    else if (t.includes('broaster') && (t.includes('x8') || t.includes('8 '))) { items.push({ nombre: 'Broaster x8 Presas + Papas', precio: 52000 }); agregado = true }
    else if (t.includes('broaster') && (t.includes('x4') || t.includes('4 '))) { items.push({ nombre: 'Broaster x4 Presas + Papas', precio: 28000 }); agregado = true }
    else if (t.includes('broaster') && t.includes('criolla')) { items.push({ nombre: 'Broaster con Criollas', precio: 18000 }); agregado = true }
    else if (t.includes('bandeja') || t.includes('mixta')) { items.push({ nombre: 'Bandeja Mixta Salsas + Papas', precio: 36000 }); agregado = true }
    else if (t.includes('salchipapa')) { items.push({ nombre: 'Salchipapa', precio: 9000 }); agregado = true }
    else if (t.includes('papa') && !t.includes('alita')) { items.push({ nombre: 'Papas a la Francesa', precio: 7000 }); agregado = true }

    if (agregado) {
      setSession(jid, { pedido: { ...session.pedido, items } })
      const ultimo = items[items.length - 1]
      await sendMessage(jid, `✅ *${ultimo.nombre}* → $${ultimo.precio.toLocaleString('es-CO')}\n\n¿Algo más? Escribe *listo* cuando termines 😊`)
    } else {
      await sendMessage(jid, `No entendí ese producto 😅\n\nEjemplos:\n_"12 alitas bbq"_\n_"broaster x4"_\n_"bandeja mixta"_\n\nO escribe *menu* para ver todo 📋`)
    }
    return
  }

  if (session.state === STATES.ESPERANDO_DIRECCION) {
    setSession(jid, { state: STATES.ESPERANDO_PAGO, pedido: { ...session.pedido, direccion: texto.trim() } })
    await sendMessage(jid, `¿Cómo vas a pagar? 💳\n\n1️⃣ Nequi\n2️⃣ Transferencia\n3️⃣ Efectivo (contra entrega)`)
    return
  }

  if (session.state === STATES.ESPERANDO_PAGO) {
    let pago = texto.trim()
    if (t === '1' || t.includes('nequi')) {
      pago = 'Nequi'
      setSession(jid, { state: STATES.ESPERANDO_COMPROBANTE, pedido: { ...session.pedido, pago } })
      await sendMessage(jid, `💚 *Pago por Nequi*\n\nNúmero Nequi: *310 467 2816*\nNombre: *Ala Bendita Chicken*\n\n💰 *Total a pagar: $${session.pedido.items.reduce((a, b) => a + b.precio, 0).toLocaleString('es-CO')}*\n\nPor favor realiza el pago y envíanos el *comprobante* 📸`)
    } else if (t === '2' || t.includes('transfer')) {
      pago = 'Transferencia'
      setSession(jid, { state: STATES.ESPERANDO_COMPROBANTE, pedido: { ...session.pedido, pago } })
      await sendMessage(jid, `🏦 *Pago por Transferencia*\n\nBanco: *Bancolombia*\nCuenta: *123-456789-00*\nNombre: *Ala Bendita Chicken*\n\n💰 *Total a pagar: $${session.pedido.items.reduce((a, b) => a + b.precio, 0).toLocaleString('es-CO')}*\n\nPor favor realiza el pago y envíanos el *comprobante* 📸`)
    } else if (t === '3' || t.includes('efectivo') || t.includes('contra')) {
      pago = 'Efectivo (contra entrega)'
      setSession(jid, { state: STATES.MENU, pedido: { items: [], nombre: '', direccion: '', pago: '' } })
      const comanda = generarComanda(jid)
      await sendMessage(jid, `🎉 *¡Pedido confirmado ${session.pedido.nombre}!*\n\n${comanda}\n\n🛵 Tu pedido está en preparación. ¡Gracias! 🍗`)
      for (const num of owners) await sendMessage(`${num.trim()}@s.whatsapp.net`, `🔔 *NUEVO PEDIDO*\n\n${comanda}`)
    } else {
      await sendMessage(jid, `Responde *1* Nequi, *2* Transferencia o *3* Efectivo 💳`)
    }
    return
  }

  if (session.state === STATES.ESPERANDO_COMPROBANTE) {
    if (hasMedia) {
      const comanda = generarComanda(jid)
      setSession(jid, { state: STATES.MENU, pedido: { items: [], nombre: '', direccion: '', pago: '' } })
      await sendMessage(jid, `✅ *¡Comprobante recibido ${session.pedido.nombre}!*\n\n${comanda}\n\n🛵 Tu pedido está confirmado y en preparación. ¡Gracias! 🍗`)
      for (const num of owners) await sendMessage(`${num.trim()}@s.whatsapp.net`, `🔔 *NUEVO PEDIDO PAGADO*\n\n${comanda}\n\n📸 Comprobante recibido`)
    } else {
      await sendMessage(jid, `📸 Por favor envía el *pantallazo del comprobante* de pago para confirmar tu pedido.`)
    }
    return
  }

  // ASESOR
  if (t === '3' || t.includes('asesor') || t.includes('humano') || t.includes('hablar con')) {
    await sendMessage(jid, `👤 Te conectamos con un asesor ahora mismo.\nUn momento por favor... ⏳`)
    for (const num of owners) await sendMessage(`${num.trim()}@s.whatsapp.net`, `⚠️ *Cliente necesita asesor*\nNúmero: ${jid.replace('@s.whatsapp.net', '')}\nMensaje: ${texto}`)
    return
  }

  // MENU OPCIONES
  if (t === '1' || t === 'menu' || t === 'menú' || t.includes('ver menu') || t.includes('carta') || t.includes('que tienen')) {
    await sendMessage(jid, MENU_MSG)
    await sendMessage(jid, `¿Deseas hacer un pedido? Escribe *2* 🍗`)
    return
  }

  if (t === '2' || t === 'pedir' || t.includes('quiero pedir') || t.includes('hacer pedido') || t.includes('ordenar')) {
    setSession(jid, { state: STATES.ESPERANDO_NOMBRE, pedido: { items: [], nombre: '', direccion: '', pago: '' } })
    await sendMessage(jid, `¡Perfecto! Vamos a armar tu pedido 🍗\n\n¿Cuál es tu nombre?`)
    return
  }

  if (t === '4' || t.includes('zona') || t.includes('barrio') || t.includes('horario') || t.includes('domicilio') || t.includes('pago')) {
    await sendMessage(jid, `ℹ️ *INFORMACIÓN ALA BENDITA CHICKEN*\n\n📍 *Zonas de entrega:*\nPoblado, Villanueva, Calimio, Mojica, Cañaveralejo, El Retiro, Guabal, Manrique, Sardi y más del sur de Cali.\n\n⏰ *Horario:*\nTodos los días 4:00pm - 11:00pm\n\n💳 *Formas de pago:*\nEfectivo, Nequi, Transferencias\n\n🛵 Domicilio GRATIS\n\n📞 310 467 2816 | 321 853 4946`)
    return
  }

  // SALUDO - BIENVENIDA
  const esSaludo = ['hola', 'buenas', 'buenos', 'hi', 'hey', 'inicio', 'start'].some(s => t.includes(s))
  if (esSaludo) {
    setSession(jid, { state: STATES.MENU, pedido: { items: [], nombre: '', direccion: '', pago: '' } })
    await sendMessage(jid, BIENVENIDA)
    return
  }

  await sendMessage(jid, BIENVENIDA)
}

// RUTAS
app.get('/', async (req, res) => {
  const { status } = getStatus()
  res.send(`<html><head><title>Ala Bendita Bot</title><meta http-equiv="refresh" content="5"><style>body{font-family:sans-serif;text-align:center;padding:40px;background:#fff6ee}h1{color:#D42B14}.status{padding:12px 24px;border-radius:20px;display:inline-block;font-weight:bold}.connected{background:#d4edda;color:#155724}.disconnected{background:#fff3cd;color:#856404}</style></head><body><h1>🍗 Ala Bendita Chicken Bot</h1><p class="status ${status === 'connected' ? 'connected' : 'disconnected'}">${status === 'connected' ? '✅ Conectado' : status === 'qr_ready' ? '📱 Escanea el QR en /qr' : '⏳ Conectando...'}</p>${status !== 'connected' ? '<p><a href="/qr">👉 Ver código QR</a></p>' : ''}</body></html>`)
})

app.get('/qr', async (req, res) => {
  const { status, qr } = getStatus()
  if (status === 'connected') return res.send('<h2 style="font-family:sans-serif;color:green;text-align:center">✅ Ya conectado</h2>')
  if (!qr) return res.send('<h2 style="font-family:sans-serif;text-align:center">⏳ Generando QR... recarga en 5 seg</h2><meta http-equiv="refresh" content="5">')
  const img = await QRCode.toDataURL(qr, { width: 300 })
  res.send(`<html><head><title>QR</title><meta http-equiv="refresh" content="30"></head><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>📱 Escanea con WhatsApp</h2><img src="${img}" style="border:4px solid #D42B14;border-radius:12px"/></body></html>`)
})

app.get('/health', (req, res) => res.json({ ok: true, status: getStatus().status }))

const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
  console.log(`🍗 Ala Bendita Chicken Bot corriendo en puerto ${PORT}`)
  setMessageHandler(handleMessage)
  await connectToWhatsApp()
})
