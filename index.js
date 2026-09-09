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
    try {
        const { q, estado, fechaD, fechaH, limit = 20, offset = 0 } = req.query;
        
        let queryStr = `SELECT t.id_ticket, t.numero_fr, c.nombre_completo AS cliente, c.ruc AS ruc_cliente, e.marca, e.modelo, e.numero_serie, t.problema_reportado, t.accesorios_incluidos, t.estado_equipo, t.estado_pago, t.fecha_ingreso, emp.nombre_completo AS empleado_receptor, 
                        (t.otm_data - 'fotos') AS otm_data, t.entrega_data, t.fp_data 
                        FROM tickets_servicio t 
                        JOIN equipos e ON t.id_equipo = e.id_equipo 
                        JOIN clientes c ON e.id_cliente = c.id_cliente 
                        LEFT JOIN empleados emp ON t.id_empleado_recepcion = emp.id_empleado 
                        WHERE 1=1`;
        
        const params = [];
        let paramIdx = 1;

        // Búsqueda Inteligente (Texto)
        if (q) {
            queryStr += ` AND (t.numero_fr ILIKE $${paramIdx} OR c.nombre_completo ILIKE $${paramIdx} OR e.marca ILIKE $${paramIdx} OR e.modelo ILIKE $${paramIdx} OR e.numero_serie ILIKE $${paramIdx})`;
            params.push(`%${q}%`);
            paramIdx++;
        }
        // Filtro por Estado
        if (estado) {
            queryStr += ` AND t.estado_equipo = $${paramIdx}`;
            params.push(estado);
            paramIdx++;
        }
        // Filtro por Fechas
        if (fechaD) {
            queryStr += ` AND t.fecha_ingreso >= $${paramIdx}`;
            params.push(fechaD);
            paramIdx++;
        }
        if (fechaH) {
            queryStr += ` AND t.fecha_ingreso <= $${paramIdx}::timestamp + interval '1 day' - interval '1 second'`;
            params.push(fechaH);
            paramIdx++;
        }

        // Paginación: Limit y Offset
        queryStr += ` ORDER BY t.fecha_ingreso DESC, t.id_ticket DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
        params.push(limit, offset);

        const r = await pool.query(queryStr, params); 
        res.json(r.rows);
    } catch (e) {
        console.error(e);
        res.status(500).send(e.message);
    }
});




// Ruta temporal para investigar la estructura de la base de datos
app.get('/api/investigar-db', async (req, res) => {
    try {
        const queryStr = `
            SELECT column_name, data_type, character_maximum_length 
            FROM information_schema.columns 
            WHERE table_name = 'tickets_servicio';
        `;
        const resultado = await pool.query(queryStr);
        res.json(resultado.rows);
    } catch (e) {
        res.status(500).send(e.message);
    }
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

// Ruta especial: Descarga las fotos SOLO cuando se abre un modal
app.get('/api/tickets/:id/fotos', async (req, res) => {
    try {
        const r = await pool.query("SELECT fotos_fr, otm_data->'fotos' AS fotos_otm FROM tickets_servicio WHERE id_ticket = $1", [req.params.id]);
        res.json(r.rows[0]);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.delete('/api/tickets/:id', async (req, res) => { await pool.query('DELETE FROM tickets_servicio WHERE id_ticket = $1', [req.params.id]); res.json({ success: true }); });

// Ruta para Guardar/Actualizar la OTM y sincronizar con Inventario
app.put('/api/tickets/:id/otm', async (req, res) => {
    const { id } = req.params;
    const { numero_fr, id_empleado, otm_data, repuestos_utilizados } = req.body; 
    // repuestos_utilizados ahora será un array exacto: [{ id_articulo, cantidad, descripcion }]

    try {
        await pool.query('BEGIN'); // Iniciamos la transacción segura

        // 1. Guardar el texto y estado de la OTM en el ticket
        await pool.query(
            'UPDATE tickets_servicio SET otm_data = $1 WHERE id_ticket = $2',
            [JSON.stringify(otm_data), id]
        );

        // 2. Sincronización inteligente con el Kárdex (Inventario)
        if (repuestos_utilizados && Array.isArray(repuestos_utilizados)) {
            // A. Limpiar las salidas previas vinculadas a esta FR exacta para evitar duplicados si se edita la OTM
            await pool.query(
                `DELETE FROM kardex_movimientos 
                 WHERE referencia_documento = $1 AND tipo_movimiento = 'SALIDA' AND observaciones = 'Consumo en OTM'`,
                [numero_fr]
            );

            // B. Insertar los consumos actualizados
            for (let rep of repuestos_utilizados) {
                if (rep.id_articulo) {
                    await pool.query(
                        `INSERT INTO kardex_movimientos (id_articulo, tipo_movimiento, cantidad, id_empleado, referencia_documento, observaciones) 
                         VALUES ($1, 'SALIDA', $2, $3, $4, 'Consumo en OTM');`,
                        [rep.id_articulo, rep.cantidad, id_empleado, numero_fr]
                    );
                }
            }
        }

        await pool.query('COMMIT');
        res.json({ message: 'OTM guardada y stock actualizado correctamente.' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("Error al guardar OTM:", err.message);
        res.status(500).json({ error: 'Error interno al sincronizar OTM y Kárdex' });
    }
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
// 4. REGISTRAR UN NUEVO EGRESO (Bimonetario)
app.post('/api/finanzas/egresos', async (req, res) => {
    try {
        const { categoria, descripcion_detalle, monto_total, metodo_pago, tipo_comprobante, nro_comprobante, fecha_egreso, moneda, tc } = req.body;
        const nuevoEgreso = await pool.query(
            `INSERT INTO egresos_operativos (categoria, descripcion_detalle, monto_total, metodo_pago, tipo_comprobante, nro_comprobante, fecha_egreso, moneda, tc) 
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_TIMESTAMP), $8, $9) RETURNING *`,
            [categoria, descripcion_detalle, monto_total, metodo_pago, tipo_comprobante, nro_comprobante, fecha_egreso || null, moneda || 'PEN', tc || 1]
        );
        res.json(nuevoEgreso.rows[0]);
    } catch (err) { 
        console.error("Error al registrar egreso:", err.message);
        res.status(500).send("Error en el servidor"); 
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
                // 1. Generamos el egreso pero en estado "PENDIENTE" (Ahora hereda Moneda y TC)
                await pool.query(
                    `INSERT INTO egresos_operativos 
                    (categoria, descripcion_detalle, monto_total, metodo_pago, tipo_comprobante, nro_comprobante, fecha_egreso, estado_pago, moneda, tc) 
                    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, 'PENDIENTE', $7, $8)`,
                    [costo.categoria, `[AUTO] ${costo.descripcion}`, costo.monto, 'NO ESPECIFICADO', 'SIN COMPROBANTE', 'AUTO-GENERADO', costo.moneda || 'PEN', costo.tc || 1]
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
        const { categoria, descripcion, monto, dia_vencimiento, moneda, tc } = req.body;
        const nuevo = await pool.query(
            `INSERT INTO costos_fijos_programados (categoria, descripcion, monto, dia_vencimiento, ultimo_mes_generado, activo, moneda, tc) 
             VALUES ($1, $2, $3, $4, '', true, $5, $6) RETURNING *`,
            [categoria, descripcion, monto, dia_vencimiento, moneda || 'PEN', tc || 1]
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
        const { categoria, descripcion, monto, dia_vencimiento, moneda, tc } = req.body;
        const actualizado = await pool.query(
            `UPDATE costos_fijos_programados 
             SET categoria = $1, descripcion = $2, monto = $3, dia_vencimiento = $4, moneda = $5, tc = $6 
             WHERE id = $7 RETURNING *`,
            [categoria, descripcion, monto, dia_vencimiento, moneda || 'PEN', tc || 1, id]
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
    const { numero_contrato, id_cliente, id_empleado_gestor, usuario_fae, nombre_equipo, marca, modelo, numero_serie, accesorios, fecha_inicio, fecha_fin, fotos_fae, observaciones_fae } = req.body;
    try {
        const query = `
            INSERT INTO contratos_alquiler 
            (numero_contrato, id_cliente, id_empleado_gestor, usuario_fae, nombre_equipo, marca, modelo, numero_serie, accesorios, fecha_inicio, fecha_fin, tarifa_total, deposito_garantia, fotos_fae, observaciones_fae)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0, $12, $13) RETURNING id_contrato;
        `;
        await pool.query(query, [numero_contrato, id_cliente, id_empleado_gestor, usuario_fae, nombre_equipo, marca, modelo, numero_serie, accesorios, fecha_inicio, fecha_fin, JSON.stringify(fotos_fae || []), observaciones_fae]);
        res.json({ mensaje: 'FAE registrado con éxito' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Crear nueva Ficha de Venta (FV)
app.post('/api/ventas', async (req, res) => {
    const { numero_fv, cliente, usuario_fv, equipo_nombre, marca, modelo, serie, accesorios, observaciones } = req.body;
    try {
        await pool.query(
            // Corrección: Ahora hay 9 variables ($1 al $9) alineadas con las 9 columnas antes de 'Pendiente Entrega'
            `INSERT INTO ventas_fv (numero_fv, cliente, usuario_fv, equipo_nombre, marca, modelo, serie, accesorios, observaciones, estado) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pendiente Entrega')`,
            [numero_fv, cliente, usuario_fv, equipo_nombre, marca, modelo, serie, accesorios, observaciones]
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
    const { usuario_far, fecha_devolucion_real, estado_retorno_equipo, fotos_far, dias_cobro } = req.body;
    try {
        await pool.query(
            "UPDATE contratos_alquiler SET usuario_far = $1, estado_alquiler = 'Devuelto', fecha_devolucion_real = $2, estado_retorno_equipo = $3, fotos_far = $4, dias_cobro = $5 WHERE id_contrato = $6", 
            [usuario_far, fecha_devolucion_real, estado_retorno_equipo, JSON.stringify(fotos_far || []), dias_cobro, req.params.id]
        );
        res.json({ mensaje: 'FAR generada y equipo devuelto' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Guardar Ficha de Entrega (FE)
// Guardar Ficha de Entrega (FE) - Incluye fotos
app.put('/api/ventas/:id/entregar', async (req, res) => {
    const { usuario_fe, fecha_entrega, observaciones_fe, fotos_fe } = req.body;
    try {
        await pool.query(
            // Corrección: Sintaxis limpia sin WHEREs repetidos
            "UPDATE ventas_fv SET usuario_fe = $1, estado = 'Entregado', fecha_entrega = $2, observaciones_fe = $3, fotos_fe = $4 WHERE id_fv = $5", 
            [usuario_fe, fecha_entrega, observaciones_fe, fotos_fe ? JSON.stringify(fotos_fe) : '[]', req.params.id]
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

// =====================================================================
// 📦 MÓDULO DE INVENTARIOS Y RENDICIÓN DE GASTOS
// =====================================================================

// 1. Obtener Categorías (Para cargar tus listas desplegables 1, 2 y 3)
app.get('/api/inventario/categorias', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM categorias_inventario ORDER BY categoria_1, categoria_2, categoria_3");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Obtener Proveedores (Para el campo 10)
app.get('/api/inventario/proveedores', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM proveedores ORDER BY razon_social");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Crear un nuevo Artículo en el Catálogo Maestro
// 3. Crear un nuevo Artículo en el Catálogo Maestro
// 3. Crear un nuevo Artículo en el Catálogo Maestro
app.post('/api/inventario/articulos', async (req, res) => {
    const { codigo_articulo, nombre_articulo, id_categoria, caracteristicas, uso_equipo, procedencia, id_proveedor, costo_unitario, url_foto_articulo, tecnologia, url_compra, info_tecnica } = req.body;
    try {
        const query = `
            INSERT INTO articulos (codigo_articulo, nombre_articulo, id_categoria, caracteristicas, uso_equipo, procedencia, id_proveedor, costo_unitario, url_foto_articulo, tecnologia, url_compra, info_tecnica) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id_articulo;
        `;
        const result = await pool.query(query, [codigo_articulo, nombre_articulo, id_categoria, caracteristicas, uso_equipo, procedencia, id_proveedor, costo_unitario, url_foto_articulo, tecnologia, url_compra, info_tecnica]);
        res.json({ mensaje: 'Artículo creado en el catálogo', id_articulo: result.rows[0].id_articulo });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Obtener Buscador de Inventario (¡Con cálculo matemático automático de stock!)
app.get('/api/inventario/articulos', async (req, res) => {
    try {
        // Hacemos un cruce (JOIN) entre el catálogo, las categorías, proveedores y el Kárdex
        const query = `
            SELECT a.*, c.categoria_1, c.categoria_2, c.categoria_3, p.razon_social AS proveedor_nombre,
                   COALESCE(SUM(CASE WHEN k.tipo_movimiento = 'ENTRADA' THEN k.cantidad ELSE 0 END), 0) AS cantidad_comprada,
                   COALESCE(SUM(CASE WHEN k.tipo_movimiento = 'SALIDA' THEN k.cantidad ELSE 0 END), 0) AS cantidad_usada,
                   COALESCE(SUM(CASE WHEN k.tipo_movimiento = 'ENTRADA' THEN k.cantidad ELSE -k.cantidad END), 0) AS cantidad_actual
            FROM articulos a
            LEFT JOIN categorias_inventario c ON a.id_categoria = c.id_categoria
            LEFT JOIN proveedores p ON a.id_proveedor = p.id_proveedor
            LEFT JOIN kardex_movimientos k ON a.id_articulo = k.id_articulo
            GROUP BY a.id_articulo, c.categoria_1, c.categoria_2, c.categoria_3, p.razon_social
            ORDER BY a.nombre_articulo;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Guardar Rendición de Gastos (El Cerebro Automatizado)
// 5. Guardar Rendición de Gastos (El Cerebro Automatizado y Puente a Finanzas)
app.post('/api/inventario/rendicion', async (req, res) => {
    const { numero_rendicion, id_empleado, monto_asignado, detalles } = req.body;
    
    try {
        await pool.query('BEGIN'); 
        
        let monto_gastado = 0;
        detalles.forEach(d => monto_gastado += parseFloat(d.subtotal));
        const saldo_balance = parseFloat(monto_asignado) - monto_gastado;

        // 1. Guardar la Cabecera
        const resRendicion = await pool.query(
            `INSERT INTO rendicion_gastos (numero_rendicion, id_empleado, monto_asignado, monto_gastado, saldo_balance, estado) 
             VALUES ($1, $2, $3, $4, $5, 'Aprobada') RETURNING id_rendicion;`,
            [numero_rendicion, id_empleado, monto_asignado, monto_gastado, saldo_balance]
        );
        const idRendicion = resRendicion.rows[0].id_rendicion;

        // Variables para clasificar el dinero enviado a Finanzas
        let monto_inventario = 0;
        let monto_movilidad = 0;
        let descripcion_inventario = `Logística (Rendición ${numero_rendicion}): `;
        let descripcion_movilidad = `Movilidad/Otros (Rendición ${numero_rendicion}): `;

        // 2. Leer cada artículo comprado
        for (let det of detalles) {
            await pool.query(
                `INSERT INTO rendicion_detalle (id_rendicion, tipo_gasto, descripcion_gasto, id_articulo, cantidad, costo_unitario, subtotal, id_proveedor) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
                [idRendicion, det.tipo_gasto, det.descripcion_gasto, det.id_articulo || null, det.cantidad, det.costo_unitario, det.subtotal, det.id_proveedor || null]
            );

            if (det.tipo_gasto === 'INVENTARIO' && det.id_articulo) {
                // A. Kárdex: Suma Stock
                await pool.query(
                    `INSERT INTO kardex_movimientos (id_articulo, tipo_movimiento, cantidad, id_empleado, referencia_documento, observaciones) 
                     VALUES ($1, 'ENTRADA', $2, $3, $4, $5);`,
                    [det.id_articulo, det.cantidad, id_empleado, numero_rendicion, 'Compra ingresada por Rendición']
                );
                
                // Actualiza Catálogo (opcional)
                await pool.query(
                    `UPDATE articulos SET id_proveedor = $1, costo_unitario = $2 WHERE id_articulo = $3;`,
                    [det.id_proveedor || null, det.costo_unitario, det.id_articulo]
                );
                
                // Sumamos dinero de inventario para Finanzas
                monto_inventario += parseFloat(det.subtotal);
                descripcion_inventario += `${det.descripcion_gasto} (S/${det.subtotal}), `;
            } else {
                // Sumamos dinero de movilidad para Finanzas
                monto_movilidad += parseFloat(det.subtotal);
                descripcion_movilidad += `${det.descripcion_gasto} (S/${det.subtotal}), `;
            }
        }

        // 3. PUENTE A FINANZAS: Enviar los Egreso separados por categoría
        
        // A. Si se gastó en Logística/Repuestos
        if (monto_inventario > 0) {
            await pool.query(
                `INSERT INTO egresos_operativos (categoria, descripcion_detalle, monto_total, metodo_pago, tipo_comprobante, nro_comprobante, moneda, tc, fecha_egreso) 
                 VALUES ('COMPRA REPUESTOS', $1, $2, 'EFECTIVO', 'Rendición', $3, 'PEN', 1.00, CURRENT_TIMESTAMP);`,
                [descripcion_inventario, monto_inventario, numero_rendicion]
            );
        }

        // B. Si se gastó en Pasajes o Viáticos
        if (monto_movilidad > 0) {
            await pool.query(
                `INSERT INTO egresos_operativos (categoria, descripcion_detalle, monto_total, metodo_pago, tipo_comprobante, nro_comprobante, moneda, tc, fecha_egreso) 
                 VALUES ('OTROS', $1, $2, 'EFECTIVO', 'Rendición', $3, 'PEN', 1.00, CURRENT_TIMESTAMP);`,
                [descripcion_movilidad, monto_movilidad, numero_rendicion]
            );
        }

        await pool.query('COMMIT'); 
        res.json({ mensaje: 'Rendición procesada: Stock actualizado y Finanzas cuadradas.' });
        
    } catch (err) {
        await pool.query('ROLLBACK'); 
        console.error("Error en rendición:", err.message);
        res.status(500).json({ error: 'Error interno al procesar la rendición' });
    }
});

// 6. Crear Nueva Categoría
app.post('/api/inventario/categorias', async (req, res) => {
    const { categoria_1, categoria_2, categoria_3 } = req.body;
    try {
        await pool.query("INSERT INTO categorias_inventario (categoria_1, categoria_2, categoria_3) VALUES ($1, $2, $3)", [categoria_1, categoria_2, categoria_3]);
        res.json({ mensaje: 'Categoría guardada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. Crear Nuevo Proveedor
app.post('/api/inventario/proveedores', async (req, res) => {
    const { razon_social, direccion, telefonos, link_ubicacion } = req.body;
    try {
        await pool.query("INSERT INTO proveedores (razon_social, direccion, telefonos, link_ubicacion) VALUES ($1, $2, $3, $4)", [razon_social, direccion, telefonos, link_ubicacion]);
        res.json({ mensaje: 'Proveedor guardado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. Editar Categoría
app.put('/api/inventario/categorias/:id', async (req, res) => {
    const { categoria_1, categoria_2, categoria_3 } = req.body;
    try {
        await pool.query(
            "UPDATE categorias_inventario SET categoria_1=$1, categoria_2=$2, categoria_3=$3 WHERE id_categoria=$4", 
            [categoria_1, categoria_2, categoria_3, req.params.id]
        );
        res.json({ mensaje: 'Categoría actualizada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. Eliminar Categoría (Con protección de dependencias)
app.delete('/api/inventario/categorias/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM categorias_inventario WHERE id_categoria=$1", [req.params.id]);
        res.json({ mensaje: 'Categoría eliminada' });
    } catch (err) { 
        // Si PostgreSQL arroja error de llave foránea (23503), es porque hay repuestos usando esta categoría
        res.status(400).json({ error: 'No se puede eliminar porque hay artículos usando esta categoría.' }); 
    }
});

// 10. Obtener Historial de Rendiciones (Con desglose de gastos)
app.get('/api/inventario/rendiciones', async (req, res) => {
    try {
        const query = `
            SELECT r.id_rendicion, r.numero_rendicion, r.monto_asignado, r.monto_gastado, r.saldo_balance, r.estado, r.fecha_registro,
                   e.nombre_completo AS empleado_nombre,
                   (
                       SELECT json_agg(json_build_object(
                           'tipo_gasto', d.tipo_gasto,
                           'descripcion_gasto', d.descripcion_gasto,
                           'articulo_nombre', a.nombre_articulo,
                           'cantidad', d.cantidad,
                           'costo_unitario', d.costo_unitario,
                           'subtotal', d.subtotal
                       ))
                       FROM rendicion_detalle d
                       LEFT JOIN articulos a ON d.id_articulo = a.id_articulo
                       WHERE d.id_rendicion = r.id_rendicion
                   ) as detalles
            FROM rendicion_gastos r
            LEFT JOIN empleados e ON r.id_empleado = e.id_empleado
            ORDER BY r.fecha_registro DESC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// 11. Editar Artículo del Catálogo Maestro
// 11. Editar Artículo del Catálogo Maestro
app.put('/api/inventario/articulos/:id', async (req, res) => {
    const { codigo_articulo, nombre_articulo, id_categoria, caracteristicas, uso_equipo, procedencia, id_proveedor, costo_unitario, url_foto_articulo, tecnologia, url_compra, info_tecnica } = req.body;
    try {
        const query = `
            UPDATE articulos 
            SET codigo_articulo = $1, nombre_articulo = $2, id_categoria = $3, caracteristicas = $4, 
                uso_equipo = $5, procedencia = $6, id_proveedor = $7, costo_unitario = $8, 
                url_foto_articulo = $9, tecnologia = $10, url_compra = $11, info_tecnica = $12
            WHERE id_articulo = $13
        `;
        await pool.query(query, [codigo_articulo, nombre_articulo, id_categoria, caracteristicas, uso_equipo, procedencia, id_proveedor, costo_unitario, url_foto_articulo, tecnologia, url_compra, info_tecnica, req.params.id]);
        res.json({ mensaje: 'Artículo actualizado exitosamente' });
    } catch (err) {
        if (err.code === '23505') res.status(400).json({ error: 'El código de artículo ya existe en otro registro.' });
        else res.status(500).json({ error: err.message });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));