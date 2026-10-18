import { startServer } from './server.mjs';
import { join } from 'node:path';
startServer({ directory:process.env.QIBIAN_SYNC_DATA || join(process.env.LOCALAPPDATA || process.cwd(), 'QibianSync'), port:Number(process.env.QIBIAN_SYNC_PORT || 17381) }).then(service => {
  console.log(`栖边本机同步服务已启动：127.0.0.1:${service.port}\n配对密钥：${service.token}\n在各浏览器的栖边设置中填写此密钥。\n数据目录：${service.directory}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await service.close(); process.exit(0); });
}).catch(error => { console.error(error.code === 'EADDRINUSE' ? '服务已在运行，配对密钥位于 %LOCALAPPDATA%\\QibianSync\\pairing-key.txt。' : error.message); process.exitCode = 1; });
