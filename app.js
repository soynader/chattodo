require("dotenv/config");
const { createBot, createFlow, createProvider, addKeyword } = require('@bot-whatsapp/bot');
const MySQLAdapter = require('@bot-whatsapp/database/mysql');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const QRPortalWeb = require('@bot-whatsapp/portal');
const welcomeFlow = require("./script/welcomeFlow");
const { run, runDetermine } = require('./script/apigroq');
const { checkActivePrompts } = require('./script/prompt');
const mysql = require('mysql2/promise');

// Configuración de la conexión a la base de datos MySQL
const adapterDB = new MySQLAdapter({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    database: process.env.MYSQL_DATABASE,
    password: process.env.MYSQLPASSWORD,
    port: parseInt(process.env.MYSQLPORT, 10),
});

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

const stateStore = {};

const getState = (phoneNumber) => {
    return stateStore[phoneNumber] || { history: [] };
};

const updateState = (phoneNumber, newState) => {
    stateStore[phoneNumber] = {
        ...getState(phoneNumber),
        ...newState
    };
};

const removeAccents = (str) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const chatbotVariable = 'bot3'; // Variable fija que asocia con el team_id

const getTeamIdFromVariable = async (variable) => {
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query('SELECT team_id FROM generateqrs WHERE botfile = ?', [variable]);
        return rows.length > 0 ? rows[0].team_id : null;
    } finally {
        connection.release();
    }
};

const getFlowsFromDatabase = async (teamId) => {
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query(`
            SELECT f.keyword, f.answer, f.media_url, f.chatbots_id
            FROM flows f
            JOIN chatbots c ON f.chatbots_id = c.id
            WHERE c.team_id = ?
        `, [teamId]);
        return rows;
    } finally {
        connection.release();
    }
};

const getWelcomesMessage = async (teamId) => {
    const connection = await pool.getConnection();
    try {
        const [welcomesRow] = await connection.query('SELECT welcomereply, media_url FROM welcomes WHERE team_id = ?', [teamId]);
        const welcomeMessage = welcomesRow[0]?.welcomereply || '';
        const mediaUrl = welcomesRow[0]?.media_url || '';
        return { welcomeMessage: welcomeMessage.trim(), mediaUrl: mediaUrl.trim() };
    } finally {
        connection.release();
    }
};

const hasReceivedWelcomes = async (phoneNumber, teamId) => {
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query('SELECT received_welcome FROM closesessions WHERE phone_number = ? AND team_id = ?', [phoneNumber, teamId]);
        return rows.length > 0 && rows[0].received_welcome;
    } finally {
        connection.release();
    }
};

const setWelcomesSent = async (phoneNumber, teamId) => {
    const connection = await pool.getConnection();
    try {
        await connection.query('INSERT INTO closesessions (phone_number, team_id, received_welcome, last_interaction) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE received_welcome = ?, last_interaction = ?', 
        [phoneNumber, teamId, true, new Date(), true, new Date()]);
    } finally {
        connection.release();
    }
};

const getChatbotState = async (chatbots_id, teamId) => {
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query('SELECT estado FROM chatbots WHERE id = ? AND team_id = ?', [chatbots_id, teamId]);
        return rows.length > 0 ? rows[0].estado : 'inactivo';
    } finally {
        connection.release();
    }
};

const closeInactiveSessions = async () => {
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query('SELECT phone_number, team_id FROM closesessions WHERE last_interaction < NOW() - INTERVAL 24 HOUR');
        for (const row of rows) {
            await connection.query('DELETE FROM closesessions WHERE phone_number = ? AND team_id = ?', [row.phone_number, row.team_id]);
            delete stateStore[row.phone_number];
        }
    } finally {
        connection.release();
    }
};

const updateLastInteraction = async (phoneNumber, teamId) => {
    const connection = await pool.getConnection();
    try {
        await connection.query('UPDATE closesessions SET last_interaction = ? WHERE phone_number = ? AND team_id = ?', [new Date(), phoneNumber, teamId]);
    } finally {
        connection.release();
    }
};

const handleMessage = async (message, adapterProvider) => {
    console.log("Mensaje entrante recibido:", message);
    const { from: sender, body } = message;
    const contactPhoneNumber = sender.split("@")[0];

    // Usa el teamId obtenido en el main
    const teamId = await getTeamIdFromVariable(chatbotVariable);
    if (!teamId) {
        console.log(`No se encontró un team_id para la variable ${chatbotVariable}`);
        return;
    }

    await closeInactiveSessions();

    if (!(await hasReceivedWelcomes(contactPhoneNumber, teamId))) {
        const { welcomeMessage, mediaUrl } = await getWelcomesMessage(teamId);
        if (welcomeMessage) {
            const messageOptions = {};
            if (mediaUrl) {
                messageOptions.media = mediaUrl;
            }
            try {
                await adapterProvider.sendMessage(contactPhoneNumber, welcomeMessage, { options: messageOptions });
            } catch (error) {
                console.error(`Error al enviar el mensaje con media: ${mediaUrl}`, error);
                await adapterProvider.sendMessage(contactPhoneNumber, welcomeMessage, { options: {} });
            }
            await setWelcomesSent(contactPhoneNumber, teamId);
        }
    } else {
        const flows = await getFlowsFromDatabase(teamId);

        let matched = false;
        const cleanedBody = removeAccents(body.toLowerCase());
        const words = cleanedBody.split(/\s+/);

        for (const flow of flows) {
            const keyword = removeAccents(flow.keyword.toLowerCase());
            if (words.includes(keyword)) {
                const chatbotState = await getChatbotState(flow.chatbots_id, teamId);
                if (chatbotState === 'inactivo') {
                    console.log(`El chatbot con ID ${flow.chatbots_id} está inactivo.`);
                    const isIAActive = await checkActivePrompts(teamId);
                    if (!isIAActive) {
                        console.log('El chatbot de IA está inactivo, no se enviará ningún mensaje.');
                        return;
                    }

                    const state = getState(contactPhoneNumber);
                    const name = '';

                    const newHistory = state.history || [];
                    newHistory.push({
                        role: 'user',
                        content: body
                    });

                    const largeResponse = await run(name, newHistory, teamId);
                    if (largeResponse.trim()) {
                        const chunks = largeResponse.split(/(?<!\d)\.\s+/g);

                        for (const chunk of chunks) {
                            await adapterProvider.sendMessage(contactPhoneNumber, chunk, { options: {} });
                        }

                        newHistory.push({
                            role: 'assistant',
                            content: largeResponse
                        });

                        updateState(contactPhoneNumber, { history: newHistory });
                    }
                    return;
                }

                const messageOptions = {};
                if (flow.media_url) {
                    messageOptions.media = flow.media_url;
                }
                try {
                    await adapterProvider.sendMessage(contactPhoneNumber, flow.answer, { options: messageOptions });
                } catch (error) {
                    console.error(`Error al enviar el mensaje con media: ${flow.media_url}`, error);
                    await adapterProvider.sendMessage(contactPhoneNumber, flow.answer, { options: {} });
                }
                matched = true;
                break;
            }
        }

        if (!matched) {
            const isIAActive = await checkActivePrompts(teamId);
            if (!isIAActive) {
                console.log('El chatbot de IA está inactivo, no se enviará ningún mensaje.');
                return;
            }

            const state = getState(contactPhoneNumber);
            const name = '';

            const newHistory = state.history || [];
            newHistory.push({
                role: 'user',
                content: body
            });

            const largeResponse = await run(name, newHistory, teamId);
            if (largeResponse.trim()) {
                const chunks = largeResponse.split(/(?<!\d)\.\s+/g);

                for (const chunk of chunks) {
                    await adapterProvider.sendMessage(contactPhoneNumber, chunk, { options: {} });
                }

                newHistory.push({
                    role: 'assistant',
                    content: largeResponse
                });

                updateState(contactPhoneNumber, { history: newHistory });
            }
        }
    }
    await updateLastInteraction(contactPhoneNumber, teamId);
};

const main = async () => {
    const adapterFlow = createFlow([]);
    const adapterProvider = createProvider(BaileysProvider);

    const bot = createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    // Obtener el team_id utilizando la variable fija
    const teamId = await getTeamIdFromVariable(chatbotVariable);
    if (!teamId) {
        console.error(`No se encontró un team_id para la variable ${chatbotVariable}`);
        return;
    }

    adapterProvider.on('qr', async (qr) => {
        console.log('QR generado:', qr);
    });

    adapterProvider.on('ready', async (phoneNumber) => {
        console.log('Bot está listo con el número de teléfono:', phoneNumber);
    });

    adapterProvider.on('message', async (message) => {
        await handleMessage(message, adapterProvider);
    });

    QRPortalWeb();
};

main();