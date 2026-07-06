import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { S3Service } from '../s3/s3.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [UsersController],
  providers: [UsersService, S3Service],
  exports: [UsersService],
})
export class UsersModule {}
