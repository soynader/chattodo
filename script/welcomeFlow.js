const { addKeyword, EVENTS } = require('@bot-whatsapp/bot');
const { run, runDetermine } = require('./apigroq');


const welcomeFlow = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, { state, gotoFlow }) => {
        try {
            const history = (state.getMyState()?.history ?? []);
            const variable = 'bot3'; // Variable fija asociada con team_id

            const teamId = await getTeamIdFromVariable(variable);
            if (!teamId) {
                throw new Error(`Team ID not found for variable ${variable}`);
            }

            const ai = await runDetermine(history, teamId);

            if (ai.toLowerCase().includes('unknown')) {
                return;
            }
        } catch (err) {
            console.log(`[ERROR]:`, err);
        }
    })
    .addAction(async (ctx, { flowDynamic, state }) => {
        try {
            const newHistory = (state.getMyState()?.history ?? []);
            const variable = 'bot3'; // Variable fija asociada con team_id
            const name = ctx?.pushName ?? '';

            const teamId = await getTeamIdFromVariable(variable);
            if (!teamId) {
                throw new Error(`Team ID not found for variable ${variable}`);
            }

            newHistory.push({
                role: 'user',
                content: ctx.body
            });

            const largeResponse = await run(name, newHistory, teamId);
            const chunks = largeResponse.split(/(?<!\d)\.\s+/g);

            for (const chunk of chunks) {
                await flowDynamic(chunk);
            }

            newHistory.push({
                role: 'assistant',
                content: largeResponse
            });

            await state.update({ history: newHistory });
        } catch (err) {
            console.log(`[ERROR]:`, err);
        }
    });

module.exports = welcomeFlow;
