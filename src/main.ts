import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api'); // 이 줄이 있어야 /api/v1/... 구조가 먹힙니다.
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
