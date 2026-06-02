import Koa from 'koa';
import Router from '@koa/router';
import { bodyParser } from '@koa/bodyparser';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { migrate, pool } from './db.js';
import { bootstrapAdmin, bootstrapEnvironmentModelProvider } from './bootstrap.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { modelProxyRoutes } from './routes/model-proxy.js';
import { webChatRoutes } from './routes/web-chat.js';
import { logisticsQuoteRoutes } from './routes/logistics-quote.js';
async function bootstrap() {
    await migrate();
    await bootstrapAdmin();
    await bootstrapEnvironmentModelProvider();
    const app = new Koa();
    const health = new Router();
    app.use(async (ctx, next) => {
        const origin = String(ctx.headers.origin ?? '');
        if (origin && config.corsOrigins.includes(origin)) {
            ctx.set('Access-Control-Allow-Origin', origin);
            ctx.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
            ctx.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
            ctx.set('Vary', 'Origin');
        }
        if (ctx.method === 'OPTIONS') {
            ctx.status = 204;
            return;
        }
        await next();
    });
    health.get('/health', (ctx) => {
        ctx.body = { status: 'ok', service: 'jelly-gateway' };
    });
    health.get('/admin', async (ctx) => {
        ctx.type = 'text/html';
        ctx.body = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
    });
    health.get('/admin.css', async (ctx) => {
        ctx.type = 'text/css';
        ctx.body = await readFile(new URL('../public/admin.css', import.meta.url), 'utf8');
    });
    health.get('/admin.js', async (ctx) => {
        ctx.type = 'application/javascript';
        ctx.body = await readFile(new URL('../public/admin.js', import.meta.url), 'utf8');
    });
    health.get('/app', async (ctx) => {
        ctx.type = 'text/html';
        ctx.body = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');
    });
    health.get('/app.css', async (ctx) => {
        ctx.type = 'text/css';
        ctx.body = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
    });
    health.get('/app.js', async (ctx) => {
        ctx.type = 'application/javascript';
        ctx.body = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
    });
    health.get('/jellyai-logo.png', async (ctx) => {
        ctx.type = 'image/png';
        ctx.body = await readFile(new URL('../public/jellyai-logo.png', import.meta.url));
    });
    app.use(bodyParser());
    app.use(health.routes());
    app.use(authRoutes.routes());
    app.use(adminRoutes.routes());
    app.use(webChatRoutes.routes());
    app.use(logisticsQuoteRoutes.routes());
    app.use(modelProxyRoutes.routes());
    app.use(async (ctx) => {
        ctx.status = 404;
        ctx.body = { code: 'NOT_FOUND', error: 'Route not found.' };
    });
    const server = app.listen(config.port, '0.0.0.0', () => {
        console.log(`[jelly-gateway] listening on :${config.port}`);
    });
    const shutdown = async () => {
        server.close();
        await pool.end();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}
bootstrap().catch((error) => {
    console.error('[jelly-gateway] bootstrap failed', error);
    process.exit(1);
});
