import { Controller, Post, Body, Get, Query, Patch, Param } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('v1/users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Post('register')
  register(@Body() body: { email: string; password: string; name: string; phone?: string; role?: string }) {
    return this.svc.register(body);
  }

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.svc.login(body.email, body.password);
  }

  @Post('social')
  findOrCreate(@Body() body: { provider: string; providerId: string; email?: string; name?: string; profileImage?: string }) {
    return this.svc.findOrCreateSocial(body);
  }

  @Get('by-email')
  findByEmail(@Query('email') email: string) {
    return this.svc.findByEmail(email);
  }

  @Get()
  findAll() {
    return this.svc.findAll();
  }

  @Patch(':id/role')
  updateRole(@Param('id') id: string, @Body() body: { role: string }) {
    return this.svc.updateRole(Number(id), body.role);
  }
}
