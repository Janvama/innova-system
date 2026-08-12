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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));