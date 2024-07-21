
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    database: process.env.MYSQL_DATABASE,
    password: process.env.MYSQLPASSWORD,
    port: parseInt(process.env.MYSQLPORT, 10),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Logger condicional
const isDebug = process.env.DEBUG === 'true';
const logger = (message) => {
    if (isDebug) {
        console.log(message);
    }
};

const fetchPrompt = async (promptType) => {
    if (!promptType) {
        console.error('Prompt type is undefined or null');
        return null;
    }

    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.execute('SELECT content FROM prompts WHERE prompt_type = ?', [promptType]);
        if (rows.length > 0) {
            return rows.map(row => row.content).join('\n'); // Concatena todos los registros INFO_NEGOCIO
        } else {
            throw new Error(`Prompt type ${promptType} not found`);
        }
    } finally {
        connection.release();
    }
};

const generatePrompt = async (name) => {
    const dateBase = await fetchPrompt('INFO_NEGOCIO');
    logger('INFO_NEGOCIO:', dateBase); // Depuración

    const prompt = await fetchPrompt('ENTRENAR_BOT');
    logger('ENTRENAR_BOT before replacement:', prompt); // Depuración

    const replacedPrompt = prompt
        .replaceAll('{customer_name}', name)
        .replaceAll('{context}', dateBase);

    logger('ENTRENAR_BOT after replacement:', replacedPrompt); // Depuración

    return replacedPrompt;
};

const checkActivePrompts = async (teamId) => {
    if (!teamId) {
        console.error('Team ID is undefined or null');
        return false;
    }

    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.execute(`
            SELECT prompts.prompt_type 
            FROM prompts 
            JOIN chatias ON prompts.chatias_id = chatias.id 
            WHERE chatias.estado = 'activo' AND chatias.team_id = ?
        `, [teamId]);
        return rows.length > 0;
    } finally {
        connection.release();
    }
};

module.exports = { generatePrompt, checkActivePrompts };
