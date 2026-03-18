import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true, // 모든 출처 허용 (테스트 시 유용)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  
  app.setGlobalPrefix('api'); // 이 줄이 있어야 /api/v1/... 구조가 먹힙니다.
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
