const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.static('public'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:innova2024@localhost:5432/innova_db',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// -- LOGIN --
app.post('/api/login', async (req, res) => {
    const { nombre, password } = req.body;
    try {
        const user = await pool.query('SELECT * FROM empleados WHERE nombre_completo = $1 AND password = $2', [nombre, password]);
        if(user.rows.length > 0) res.json({ success: true, user: user.rows[0] });
        else res.status(401).json({ error: 'Credenciales incorrectas' });
    } catch (error) { res.status(500).send(error.message); }
});

// -- CLIENTES --
app.get('/api/clientes', async (req, res) => { const r = await pool.query('SELECT * FROM clientes ORDER BY id_cliente DESC'); res.json(r.rows); });
app.post('/api/clientes', async (req, res) => { const { nombre_completo, telefono, ruc } = req.body; await pool.query('INSERT INTO clientes (nombre_completo, telefono, ruc) VALUES ($1, $2, $3)', [nombre_completo, telefono, ruc || '']); res.json({ success: true }); });
app.put('/api/clientes/:id', async (req, res) => { const { nombre_completo, telefono, ruc } = req.body; await pool.query('UPDATE clientes SET nombre_completo=$1, telefono=$2, ruc=$3 WHERE id_cliente=$4', [nombre_completo, telefono, ruc || '', req.params.id]); res.json({ success: true }); });
app.delete('/api/clientes/:id', async (req, res) => { try { await pool.query('DELETE FROM clientes WHERE id_cliente = $1', [req.params.id]); res.json({ success: true }); } catch (e) { res.status(400).json({ error: 'Conflicto FR.' }); } });

// -- EMPLEADOS --
app.get('/api/empleados', async (req, res) => { const r = await pool.query('SELECT * FROM empleados ORDER BY id_empleado ASC'); res.json(r.rows); });
app.post('/api/empleados', async (req, res) => { const { nombre_completo, rol, password } = req.body; await pool.query('INSERT INTO empleados (nombre_completo, rol, password) VALUES ($1, $2, $3)', [nombre_completo, rol, password]); res.json({ success: true }); });
app.put('/api/empleados/:id', async (req, res) => { const { nombre_completo, rol, password } = req.body; if(password) await pool.query('UPDATE empleados SET nombre_completo=$1, rol=$2, password=$3 WHERE id_empleado=$4', [nombre_completo, rol, password, req.params.id]); else await pool.query('UPDATE empleados SET nombre_completo=$1, rol=$2 WHERE id_empleado=$3', [nombre_completo, rol, req.params.id]); res.json({ success: true }); });
app.delete('/api/empleados/:id', async (req, res) => { try { await pool.query('DELETE FROM empleados WHERE id_empleado = $1', [req.params.id]); res.json({ success: true }); } catch (e) { res.status(400).json({ error: 'Conflicto FR.' }); } });

// -- PLANTILLAS --
app.get('/api/plantillas', async (req, res) => { const r = await pool.query('SELECT * FROM plantillas_equipos ORDER BY id_plantilla ASC'); res.json(r.rows); });
app.get('/api/plantillas/:id/accesorios', async (req, res) => { const r = await pool.query('SELECT * FROM accesorios_plantilla WHERE id_plantilla = $1', [req.params.id]); res.json(r.rows); });
app.post('/api/plantillas', async (req, res) => {
    const { nombre_plantilla, marca_defecto, modelo_defecto, accesorios } = req.body;
    const n = await pool.query('INSERT INTO plantillas_equipos (nombre_plantilla, marca_defecto, modelo_defecto) VALUES ($1, $2, $3) RETURNING id_plantilla', [nombre_plantilla, marca_defecto, modelo_defecto]);
    for (let acc of accesorios) if (acc.trim() !== '') await pool.query('INSERT INTO accesorios_plantilla (id_plantilla, nombre_accesorio) VALUES ($1, $2)', [n.rows[0].id_plantilla, acc.trim()]);
    res.json({ success: true });
});
// EDITAR PLANTILLA Y SUS ACCESORIOS COMPLETOS
app.put('/api/plantillas/:id', async (req, res) => { 
    try {
        const { nombre_plantilla, marca_defecto, modelo_defecto, accesorios } = req.body; 
        await pool.query('UPDATE plantillas_equipos SET nombre_plantilla=$1, marca_defecto=$2, modelo_defecto=$3 WHERE id_plantilla=$4', [nombre_plantilla, marca_defecto, modelo_defecto, req.params.id]); 
        if (Array.isArray(accesorios)) {
            await pool.query('DELETE FROM accesorios_plantilla WHERE id_plantilla = $1', [req.params.id]);
            for (let acc of accesorios) if (acc.trim() !== '') await pool.query('INSERT INTO accesorios_plantilla (id_plantilla, nombre_accesorio) VALUES ($1, $2)', [req.params.id, acc.trim()]);
        }
        res.json({ success: true }); 
    } catch(e) { res.status(500).send(e.message); }
});
app.delete('/api/plantillas/:id', async (req, res) => { try { await pool.query('DELETE FROM accesorios_plantilla WHERE id_plantilla = $1', [req.params.id]); await pool.query('DELETE FROM plantillas_equipos WHERE id_plantilla = $1', [req.params.id]); res.json({ success: true }); } catch (e) { res.status(400).json({ error: 'Conflicto bd.' }); } });

// -- TICKETS (FR, OTM, ENTREGA, FP) --
app.post('/api/tickets', async (req, res) => {
    try {
        const { id_cliente, id_empleado, numero_fr, marca, modelo, numero_serie, accesorios, problema_reportado, fotos_fr } = req.body;
        const checkFR = await pool.query('SELECT id_ticket FROM tickets_servicio WHERE numero_fr = $1', [numero_fr]);
        if (checkFR.rows.length > 0) return res.status(400).json({ error: 'Error: El número de FR ya existe en el sistema.' });

        const nEq = await pool.query('INSERT INTO equipos (id_cliente, marca, modelo, numero_serie) VALUES ($1, $2, $3, $4) RETURNING id_equipo', [id_cliente, marca, modelo, numero_serie]);
        await pool.query(
            `INSERT INTO tickets_servicio (numero_fr, id_equipo, id_empleado_recepcion, problema_reportado, accesorios_incluidos, estado_equipo, estado_pago, fotos_fr) 
             VALUES ($1, $2, $3, $4, $5, 'En Recepción', 'Pendiente', $6)`, 
            [numero_fr, nEq.rows[0].id_equipo, id_empleado, problema_reportado, accesorios, JSON.stringify(fotos_fr || [])]
        );
        res.json({ success: true });
    } catch (error) { res.status(500).send(error.message); }
});

app.get('/api/tickets', async (req, res) => {
    const c = `SELECT t.id_ticket, t.numero_fr, c.nombre_completo AS cliente, c.ruc AS ruc_cliente, e.marca, e.modelo, e.numero_serie, t.problema_reportado, t.accesorios_incluidos, t.estado_equipo, t.estado_pago, t.fecha_ingreso, emp.nombre_completo AS empleado_receptor, t.otm_data, t.entrega_data, t.fp_data, t.fotos_fr 
               FROM tickets_servicio t JOIN equipos e ON t.id_equipo = e.id_equipo JOIN clientes c ON e.id_cliente = c.id_cliente LEFT JOIN empleados emp ON t.id_empleado_recepcion = emp.id_empleado ORDER BY t.id_ticket DESC;`;
    const r = await pool.query(c); res.json(r.rows);
});

// EDITAR DATOS BÁSICOS DE FR E ACCESORIOS INCLUIDOS (Editar FR)
// Ruta de actualización básica (Editar FR)
app.put('/api/tickets/:id/basico', async (req, res) => {
    const { id } = req.params;
    const { marca, modelo, numero_serie, problema_reportado, accesorios_incluidos, fecha_ingreso } = req.body;
    
    console.log(`[AVISO] Intentando actualizar FR ID: ${id} con la nueva fecha:`, fecha_ingreso);

    try {
        // 1. Primero, averiguamos qué equipo (id_equipo) pertenece a esta FR
        const ticketResult = await pool.query('SELECT id_equipo FROM tickets_servicio WHERE id_ticket = $1', [id]);
        
        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }
        const idEquipo = ticketResult.rows[0].id_equipo;

        // 2. Actualizamos los datos técnicos en la tabla "equipos"
        await pool.query(
            'UPDATE equipos SET marca = $1, modelo = $2, numero_serie = $3 WHERE id_equipo = $4',
            [marca, modelo, numero_serie, idEquipo]
        );

        // 3. Actualizamos la fecha, problema y accesorios en la tabla "tickets_servicio"
        await pool.query(
            'UPDATE tickets_servicio SET problema_reportado = $1, accesorios_incluidos = $2, fecha_ingreso = $3 WHERE id_ticket = $4',
            [problema_reportado, accesorios_incluidos, fecha_ingreso, id]
        );

        res.json({ message: 'FR y Equipo actualizados correctamente' });
    } catch (err) {
        console.error("Error al actualizar en DB:", err.message);
        res.status(500).json({ error: 'Error del servidor al actualizar FR' });
    }
});

app.delete('/api/tickets/:id', async (req, res) => { await pool.query('DELETE FROM tickets_servicio WHERE id_ticket = $1', [req.params.id]); res.json({ success: true }); });

app.put('/api/tickets/:id/otm', async (req, res) => {
    try {
        const { id } = req.params; const otmData = req.body;
        const tk = await pool.query('SELECT estado_equipo FROM tickets_servicio WHERE id_ticket = $1', [id]);
        let nEst = tk.rows[0].estado_equipo;
        if (nEst !== 'Entregado') { if (otmData.fecha_termino && otmData.fecha_termino.trim() !== '') nEst = 'OTM finalizado'; else nEst = 'OTM en proceso'; }
        await pool.query("UPDATE tickets_servicio SET otm_data = $1, estado_equipo = $2 WHERE id_ticket = $3", [otmData, nEst, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

app.put('/api/tickets/:id/entrega', async (req, res) => {
    try { await pool.query("UPDATE tickets_servicio SET entrega_data = $1, estado_equipo = 'Entregado' WHERE id_ticket = $2", [req.body, req.params.id]); res.json({ success: true }); } 
    catch (e) { res.status(500).send(e.message); }
});

app.put('/api/tickets/:id/fp', async (req, res) => {
    try {
        const { id } = req.params; const fpData = req.body;
        let estadoPago = fpData.pagado ? 'Pagado' : 'Pendiente de Pago';
        await pool.query("UPDATE tickets_servicio SET fp_data = $1, estado_pago = $2 WHERE id_ticket = $3", [fpData, estadoPago, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

// =====================================================================
// 💰 MÓDULO DE FINANZAS - INNOVA ELECTRONICS S.A.C.
// =====================================================================

// 1. REGISTRAR UN NUEVO INGRESO (De Mantenimiento, Ventas o Alquileres)
// 1. REGISTRAR UN NUEVO INGRESO (Actualizado para Dólares y TC)
// 1. REGISTRAR O ACTUALIZAR UN INGRESO (Evita duplicados)
// 1. REGISTRAR O ACTUALIZAR UN INGRESO (Actualizado para modificar Fechas)
app.post('/api/finanzas/ingresos', async (req, res) => {
    try {
        const { 
            origen_modulo, nro_documento_origen, id_cliente, nombre_cliente, 
            concepto, monto_subtotal, impuesto_igv, monto_total, 
            estado_pago, monto_pagado, saldo_pendiente, metodo_pago, moneda, tc,
            fecha_emision // 👈 Recibimos la nueva fecha desde el frontend
        } = req.body;

        const check = await pool.query(
            "SELECT id_transaccion FROM transacciones_financieras WHERE nro_documento_origen = $1 AND origen_modulo = $2",
            [nro_documento_origen, origen_modulo]
        );

        if (check.rows.length > 0) {
            // SI YA EXISTE: Ahora también actualizamos la fecha_emision
            const actualizado = await pool.query(
                `UPDATE transacciones_financieras 
                 SET concepto=$1, monto_subtotal=$2, impuesto_igv=$3, monto_total=$4, 
                     estado_pago=$5, monto_pagado=$6, saldo_pendiente=$7, metodo_pago=$8, moneda=$9, tc=$10, fecha_emision=COALESCE($13, fecha_emision)
                 WHERE nro_documento_origen=$11 AND origen_modulo=$12 RETURNING *`,
                [concepto, monto_subtotal, impuesto_igv, monto_total, estado_pago, monto_pagado, saldo_pendiente, metodo_pago, moneda || 'PEN', tc || 1, nro_documento_origen, origen_modulo, fecha_emision || null]
            );
            return res.json(actualizado.rows[0]);
        } else {
            // SI NO EXISTE: Lo insertamos con su fecha correspondiente
            const nuevo = await pool.query(
                `INSERT INTO transacciones_financieras 
                (origen_modulo, nro_documento_origen, id_cliente, nombre_cliente, concepto, monto_subtotal, impuesto_igv, monto_total, estado_pago, monto_pagado, saldo_pendiente, metodo_pago, moneda, tc, fecha_emision) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, CURRENT_TIMESTAMP)) RETURNING *`,
                [origen_modulo, nro_documento_origen, id_cliente, nombre_cliente, concepto, monto_subtotal, impuesto_igv, monto_total, estado_pago, monto_pagado, saldo_pendiente, metodo_pago, moneda || 'PEN', tc || 1, fecha_emision || null]
            );
            return res.json(nuevo.rows[0]);
        }
    } catch (err) {
        console.error("Error al registrar/actualizar ingreso:", err.message);
        res.status(500).send("Error en el servidor al registrar el ingreso");
    }
});

// 2. OBTENER TODOS LOS INGRESOS
app.get('/api/finanzas/ingresos', async (req, res) => {
    try {
        const ingresos = await pool.query("SELECT * FROM transacciones_financieras ORDER BY fecha_emision DESC");
        res.json(ingresos.rows);
    } catch (err) { res.status(500).send("Error en el servidor"); }
});

// 3. ELIMINAR UN INGRESO
app.delete('/api/finanzas/ingresos/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM transacciones_financieras WHERE id_transaccion = $1", [req.params.id]);
        res.json({ message: "Ingreso eliminado exitosamente" });
    } catch (err) { res.status(500).send("Error al eliminar ingreso"); }
});

// 4. REGISTRAR UN NUEVO EGRESO 
// 4. REGISTRAR UN NUEVO EGRESO (Actualizado para recibir fecha personalizada)
app.post('/api/finanzas/egresos', async (req, res) => {
    try {
        const { categoria, descripcion_detalle, monto_total, metodo_pago, tipo_comprobante, nro_comprobante, fecha_egreso } = req.body;
        const nuevoEgreso = await pool.query(
            `INSERT INTO egresos_operativos (categoria, descripcion_detalle, monto_total, metodo_pago, tipo_comprobante, nro_comprobante, fecha_egreso) 
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_TIMESTAMP)) RETURNING *`,
            [categoria, descripcion_detalle, monto_total, metodo_pago, tipo_comprobante, nro_comprobante, fecha_egreso || null]
        );
        res.json(nuevoEgreso.rows[0]);
    } catch (err) { 
        console.error("Error al registrar egreso:", err.message);
        res.status(500).send("Error en el servidor al registrar el egreso"); 
    }
});

// 5. OBTENER TODOS LOS EGRESOS
app.get('/api/finanzas/egresos', async (req, res) => {
    try {
        const egresos = await pool.query("SELECT * FROM egresos_operativos ORDER BY fecha_egreso DESC");
        res.json(egresos.rows);
    } catch (err) { res.status(500).send("Error en el servidor"); }
});

// 6. ELIMINAR UN EGRESO
app.delete('/api/finanzas/egresos/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM egresos_operativos WHERE id_egreso = $1", [req.params.id]);
        res.json({ message: "Egreso eliminado exitosamente" });
    } catch (err) { res.status(500).send("Error al eliminar egreso"); }
});

// 7. EVALUACIÓN PEREZOSA: ALERTAS DE COBROS Y PAGOS
app.get('/api/finanzas/alertas', async (req, res) => {
    try {
        const hoy = new Date();
        // Ajustamos al huso horario de Perú (UTC-5)
        hoy.setHours(hoy.getHours() - 5);
        
        const mesActual = hoy.toISOString().substring(0, 7); // Obtiene "YYYY-MM" (Ej: "2026-08")
        const diaActual = hoy.getDate(); // Obtiene el día (Ej: 14)

        // --- A. REVISIÓN DE COSTOS FIJOS ---
        const costosFijos = await pool.query("SELECT * FROM costos_fijos_programados WHERE activo = true");
        
        for (let costo of costosFijos.rows) {
            // Lógica: Si ya llegamos al día de pago Y aún no se ha generado en este mes...
            if (diaActual >= costo.dia_vencimiento && costo.ultimo_mes_generado !== mesActual) {
                
                // 1. Generamos el egreso pero en estado "PENDIENTE"
                await pool.query(
                    `INSERT INTO egresos_operativos 
                    (categoria, descripcion_detalle, monto_total, metodo_pago, tipo_comprobante, nro_comprobante, fecha_egreso, estado_pago) 
                    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, 'PENDIENTE')`,
                    [costo.categoria, `[AUTO] ${costo.descripcion}`, costo.monto, 'NO ESPECIFICADO', 'SIN COMPROBANTE', 'AUTO-GENERADO']
                );

                // 2. Actualizamos la plantilla para que el servidor recuerde que YA lo generó este mes y no lo duplique
                await pool.query(
                    `UPDATE costos_fijos_programados SET ultimo_mes_generado = $1 WHERE id = $2`,
                    [mesActual, costo.id]
                );
            }
        }

        // --- B. RECOPILAR TODAS LAS ALERTAS PARA EL DASHBOARD ---
        
        // Cuentas por Pagar (Egresos pendientes, incluyendo los recién autogenerados)
        const porPagar = await pool.query("SELECT * FROM egresos_operativos WHERE estado_pago = 'PENDIENTE' ORDER BY fecha_egreso ASC");
        
        // Cuentas por Cobrar (Ingresos de FP que estén PENDIENTES o ADELANTOS)
        const porCobrar = await pool.query("SELECT * FROM transacciones_financieras WHERE estado_pago IN ('PENDIENTE', 'ADELANTO') ORDER BY fecha_emision ASC");

        // Enviamos todo al Dashboard
        res.json({
            cuentas_por_pagar: porPagar.rows,
            cuentas_por_cobrar: porCobrar.rows
        });

    } catch (err) {
        console.error("Error al procesar alertas perezosas:", err.message);
        res.status(500).send("Error en el servidor");
    }
});

// 8. CONFIRMAR PAGO DE EGRESO (Cambiar de PENDIENTE a PAGADO)
// 8. CONFIRMAR PAGO DE EGRESO (Actualizar Monto, Fecha a Hoy y Estado a PAGADO)
app.put('/api/finanzas/egresos/:id/pagar', async (req, res) => {
    try {
        const { id } = req.params;
        const { monto_final } = req.body; // 👈 Recibimos el monto que el usuario escriba
        
        const actualizado = await pool.query(
            `UPDATE egresos_operativos 
             SET estado_pago = 'PAGADO', 
                 fecha_egreso = CURRENT_TIMESTAMP, 
                 monto_total = $2 
             WHERE id_egreso = $1 RETURNING *`,
            [id, monto_final]
        );
        res.json(actualizado.rows[0]);
    } catch (err) {
        console.error("Error al confirmar pago de egreso:", err.message);
        res.status(500).send("Error en el servidor al confirmar el pago");
    }
});

// --- RUTAS DE GESTIÓN DE COSTOS FIJOS PROGRAMADOS ---

// Obtener la lista de costos fijos
app.get('/api/finanzas/costos-fijos', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM costos_fijos_programados WHERE activo = true ORDER BY dia_vencimiento ASC");
        res.json(result.rows);
    } catch (err) {
        console.error("Error al obtener costos fijos:", err.message);
        res.status(500).send("Error en el servidor");
    }
});

// Guardar un nuevo costo fijo
app.post('/api/finanzas/costos-fijos', async (req, res) => {
    try {
        const { categoria, descripcion, monto, dia_vencimiento } = req.body;
        const nuevo = await pool.query(
            `INSERT INTO costos_fijos_programados (categoria, descripcion, monto, dia_vencimiento, ultimo_mes_generado, activo) 
             VALUES ($1, $2, $3, $4, '', true) RETURNING *`,
            [categoria, descripcion, monto, dia_vencimiento]
        );
        res.json(nuevo.rows[0]);
    } catch (err) {
        console.error("Error al guardar costo fijo:", err.message);
        res.status(500).send("Error en el servidor");
    }
});

// Editar un costo fijo existente
app.put('/api/finanzas/costos-fijos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { categoria, descripcion, monto, dia_vencimiento } = req.body;
        const actualizado = await pool.query(
            `UPDATE costos_fijos_programados 
             SET categoria = $1, descripcion = $2, monto = $3, dia_vencimiento = $4 
             WHERE id = $5 RETURNING *`,
            [categoria, descripcion, monto, dia_vencimiento, id]
        );
        res.json(actualizado.rows[0]);
    } catch (err) {
        console.error("Error al editar costo fijo:", err.message);
        res.status(500).send("Error en el servidor");
    }
});

// Eliminar (Desactivar) un costo fijo
app.delete('/api/finanzas/costos-fijos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("UPDATE costos_fijos_programados SET activo = false WHERE id = $1", [id]);
        res.json({ message: "Costo fijo eliminado correctamente" });
    } catch (err) {
        console.error("Error al eliminar costo fijo:", err.message);
        res.status(500).send("Error en el servidor");
    }
});



// ========================================================
//        MÓDULO COMERCIAL: VENTAS Y ALQUILERES (V2)
// ========================================================

// 1. Obtener datos para el Panel de Control y Líneas de Tiempo
app.get('/api/alquileres', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, c.nombre_completo as cliente, e.nombre_completo as gestor
            FROM contratos_alquiler a
            LEFT JOIN clientes c ON a.id_cliente = c.id_cliente
            LEFT JOIN empleados e ON a.id_empleado_gestor = e.id_empleado
            ORDER BY a.fecha_registro DESC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 1. Obtener todas las Ventas (Para el Panel Principal)
app.get('/api/ventas', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM ventas_fv ORDER BY id_fv DESC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. TÉCNICOS: Crear FAE (Alquiler salida con fotos)
// 2. TÉCNICOS: Crear FAE (Alquiler salida con fotos y observaciones)
app.post('/api/alquileres', async (req, res) => {
    const { numero_contrato, id_cliente, id_empleado_gestor, nombre_equipo, marca, modelo, numero_serie, accesorios, fecha_inicio, fecha_fin, fotos_fae, observaciones_fae } = req.body;
    try {
        const query = `
            INSERT INTO contratos_alquiler 
            (numero_contrato, id_cliente, id_empleado_gestor, nombre_equipo, marca, modelo, numero_serie, accesorios, fecha_inicio, fecha_fin, tarifa_total, deposito_garantia, fotos_fae, observaciones_fae)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, $11, $12) RETURNING id_contrato;
        `;
        await pool.query(query, [numero_contrato, id_cliente, id_empleado_gestor, nombre_equipo, marca, modelo, numero_serie, accesorios, fecha_inicio, fecha_fin, JSON.stringify(fotos_fae || []), observaciones_fae]);
        res.json({ mensaje: 'FAE registrado con éxito' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Crear nueva Ficha de Venta (FV)
app.post('/api/ventas', async (req, res) => {
    const { numero_fv, cliente, equipo_nombre, marca, modelo, serie, accesorios, observaciones } = req.body;
    try {
        await pool.query(
            `INSERT INTO ventas_fv (numero_fv, cliente, equipo_nombre, marca, modelo, serie, accesorios, observaciones, estado) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pendiente Entrega')`,
            [numero_fv, cliente, equipo_nombre, marca, modelo, serie, accesorios, observaciones]
        );
        res.json({ mensaje: 'FV creada exitosamente' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Guardar Factura Proforma (FP) y Finanzas
app.put('/api/ventas/:id/fp', async (req, res) => {
    const { monto_total, forma_pago, estado_pago, monto_pagado, fp_data } = req.body;
    try {
        await pool.query(
            "UPDATE ventas_fv SET monto_total = $1, forma_pago = $2, estado_pago = $3, monto_pagado = $4, fp_data = $5 WHERE id_fv = $6", 
            [monto_total, forma_pago, estado_pago, monto_pagado, fp_data, req.params.id]
        );
        res.json({ mensaje: 'FP de Venta actualizada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. ADMIN: Guardar Factura Proforma (FP) de Alquiler Avanzada
app.put('/api/alquileres/:id/fp', async (req, res) => {
    const { tarifa_total, deposito_garantia, costo_por_dia, dias_cobro, descuento, igv, moneda, tc, monto_pagado } = req.body;
    try {
        await pool.query(
            "UPDATE contratos_alquiler SET tarifa_total = $1, deposito_garantia = $2, costo_por_dia = $3, dias_cobro = $4, descuento = $5, igv = $6, moneda = $7, tc = $8, monto_pagado = $9 WHERE id_contrato = $10", 
            [tarifa_total, deposito_garantia, costo_por_dia, dias_cobro, descuento, igv, moneda, tc, monto_pagado, req.params.id]
        );
        res.json({ mensaje: 'FP de Alquiler actualizada con cálculos' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. TÉCNICOS/ADMIN: Concretar Logística (Marcar como Devuelto o Entregado)
// 6. TÉCNICOS/ADMIN: Concretar Logística (Generar FAR y FE)
// 6. TÉCNICOS/ADMIN: Concretar Logística (Generar FAR con fotos)
// 6. TÉCNICOS/ADMIN: Concretar Logística (Generar FAR, calcular días)
app.put('/api/alquileres/:id/devolver', async (req, res) => {
    const { fecha_devolucion_real, estado_retorno_equipo, fotos_far, dias_cobro } = req.body;
    try {
        await pool.query(
            "UPDATE contratos_alquiler SET estado_alquiler = 'Devuelto', fecha_devolucion_real = $1, estado_retorno_equipo = $2, fotos_far = $3, dias_cobro = $4 WHERE id_contrato = $5", 
            [fecha_devolucion_real, estado_retorno_equipo, JSON.stringify(fotos_far || []), dias_cobro, req.params.id]
        );
        res.json({ mensaje: 'FAR generada y equipo devuelto' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Guardar Ficha de Entrega (FE)
// Guardar Ficha de Entrega (FE) - Incluye fotos
app.put('/api/ventas/:id/entregar', async (req, res) => {
    const { fecha_entrega, observaciones_fe, fotos_fe } = req.body;
    try {
        await pool.query(
            "UPDATE ventas_fv SET estado = 'Entregado', fecha_entrega = $1, observaciones_fe = $2, fotos_fe = $3 WHERE id_fv = $4", 
            [fecha_entrega, observaciones_fe, fotos_fe ? JSON.stringify(fotos_fe) : '[]', req.params.id]
        );
        res.json({ mensaje: 'Ficha de Entrega generada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. ADMIN: Eliminar Registros Comerciales (Y limpiar su impacto en Finanzas)
app.delete('/api/alquileres/:id', async (req, res) => {
    try {
        // A. Buscamos el N° de Documento para borrar el ingreso en Finanzas
        const alq = await pool.query("SELECT numero_contrato FROM contratos_alquiler WHERE id_contrato = $1", [req.params.id]);
        if (alq.rows.length > 0) {
            await pool.query("DELETE FROM transacciones_financieras WHERE nro_documento_origen = $1 AND origen_modulo = 'ALQUILER'", [alq.rows[0].numero_contrato]);
        }
        // B. Borramos el contrato comercial
        await pool.query("DELETE FROM contratos_alquiler WHERE id_contrato = $1", [req.params.id]);
        res.json({ mensaje: 'Alquiler y registro financiero eliminados' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Eliminar Venta
app.delete('/api/ventas/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM ventas_fv WHERE id_fv = $1", [req.params.id]);
        res.json({ mensaje: 'Venta eliminada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =========================================================
// HISTORIAL DE PAGOS PARCIALES (INGRESOS PALPABLES EN CAJA)
// =========================================================
app.post('/api/finanzas/pagos_parciales', async (req, res) => {
    const { origen_modulo, nro_documento, cliente, monto_abonado, moneda, tc } = req.body;
    try {
        await pool.query(
            "INSERT INTO historial_pagos (origen_modulo, nro_documento, cliente, monto_abonado, moneda, tc) VALUES ($1, $2, $3, $4, $5, $6)",
            [origen_modulo, nro_documento, cliente, monto_abonado, moneda || 'PEN', tc || 1]
        );
        res.json({ mensaje: 'Abono palpable registrado en el historial' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/finanzas/pagos_parciales', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM historial_pagos ORDER BY fecha_pago DESC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/finanzas/pagos_parciales/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM historial_pagos WHERE id_pago = $1", [req.params.id]);
        res.json({ mensaje: 'Abono eliminado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =========================================================
// MÓDULO COMERCIAL: FICHA DE VENTA (FV) Y FP DE VENTAS
// =========================================================
app.post('/api/comercial/fv', async (req, res) => {
    const { numero_fv, cliente, equipo_nombre, marca, modelo, serie, accesorios, observaciones } = req.body;
    try {
        await pool.query(
            `INSERT INTO ventas_fv (numero_fv, cliente, equipo_nombre, marca, modelo, serie, accesorios, observaciones) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [numero_fv, cliente, equipo_nombre, marca, modelo, serie, accesorios, observaciones]
        );
        res.json({ mensaje: 'Ficha de Venta creada exitosamente' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/comercial/fv', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM ventas_fv ORDER BY id_fv DESC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/comercial/fv/:id/fp', async (req, res) => {
    try {
        const { fp_data, estado } = req.body;
        await pool.query("UPDATE ventas_fv SET fp_data = $1, estado = $2 WHERE id_fv = $3", [fp_data, estado, req.params.id]);
        res.json({ mensaje: 'Factura Proforma de Venta guardada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));