import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { appErr } from '../common/errors';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { CardsService } from './cards.service';

class PinOptsDto {
  @IsOptional() @IsString() pin?: string;              // kosong = PIN acak otomatis
  @IsOptional() @IsBoolean() mustChange?: boolean;     // default true: santri wajib ganti saat pertama dipakai
}
class IssueDto extends PinOptsDto { @IsUUID() santriId: string }
class BulkIssueDto {
  @IsOptional() @IsString() kelas?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(300) @IsUUID('all', { each: true }) santriIds?: string[];
}
class ReasonDto { @IsString() @MinLength(3, { message: 'Alasan wajib diisi' }) reason: string }
class ReplaceDto extends PinOptsDto { @IsString() @MinLength(3, { message: 'Alasan wajib diisi' }) reason: string }
class ChangePinDto {
  @IsString() barcode: string;
  @IsString() currentPin: string;
  @IsString() newPin: string;
}

@Controller('cards')
class CardsController {
  constructor(private svc: CardsService) {}

  @Roles('ADMIN') @Post('issue')
  issue(@CurrentUser() u: AuthUser, @Body() b: IssueDto) { return this.svc.issue(u.id, b.santriId, { pin: b.pin, mustChange: b.mustChange }); }

  @Roles('ADMIN') @Post('issue-bulk')
  issueBulk(@CurrentUser() u: AuthUser, @Body() b: BulkIssueDto) {
    if (!b.kelas?.trim() && !b.santriIds?.length) throw appErr(400, 'TARGET_REQUIRED', 'Pilih kelas atau daftar santri');
    return this.svc.issueBulk(u.id, { kelas: b.kelas, santriIds: b.santriIds });
  }

  @Roles('ADMIN', 'BENDAHARA', 'KASIR') @Get()
  history(@Query('santriId', ParseUUIDPipe) santriId: string) { return this.svc.history(santriId); }

  @Roles('ADMIN') @Get(':id/preview')
  preview(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.preview(u.id, id); }

  @Roles('ADMIN') @Post(':id/suspend')
  suspend(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto) { return this.svc.suspend(u.id, id, b.reason); }

  @Roles('ADMIN') @Post(':id/unsuspend')
  unsuspend(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.unsuspend(u.id, id); }

  @Roles('ADMIN') @Post(':id/unlock')
  unlock(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.unlock(u.id, id); }

  @Roles('ADMIN') @Post(':id/reset-pin')
  resetPin(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: PinOptsDto) { return this.svc.resetPin(u.id, id, { pin: b.pin, mustChange: b.mustChange }); }

  @Roles('ADMIN') @Post(':id/replace')
  replace(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: ReplaceDto) { return this.svc.replace(u.id, id, b.reason, { pin: b.pin, mustChange: b.mustChange }); }

  @Roles('ADMIN', 'KASIR') @Throttle({ default: { limit: Number(process.env.PIN_RATE_LIMIT ?? 120), ttl: 60_000 } }) @Post('change-pin')
  changePin(@CurrentUser() u: AuthUser, @Body() b: ChangePinDto) { return this.svc.changePin(u.id, b.barcode, b.currentPin, b.newPin); }
}

@Module({ controllers: [CardsController], providers: [CardsService], exports: [CardsService] })
export class CardsModule {}
