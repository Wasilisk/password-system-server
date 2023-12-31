import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { generateOTP } from '../common/utils/codeGenerator';
import { Prisma } from '@prisma/client';
import { getExpiry, isTokenExpired } from '../common/utils/dateTimeUtility';
import { sendSMS } from '../common/utils/twilio';
import { RequestWithUserRole } from 'src/common/interfaces/request-with-user-role.interface';
import _ from 'underscore';

@Injectable()
export class AccountService {
  constructor(private prisma: PrismaService) {}

  async setTwoFA(req: RequestWithUserRole) {
    const {
      body: { set_2fa },
    } = req;
    const userDetails = req['user'];

    const user = await this.prisma.user.findUnique({
      where: { id: userDetails.sub },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    if (user.twoFA === set_2fa) {
      return { success: true };
    }

    if (user.twoFA && set_2fa == false) {
      const otp = generateOTP(6);
      const otpPayload: Prisma.OtpUncheckedCreateInput = {
        userId: user.id,
        code: otp,
        useCase: 'D2FA',
        expiresAt: getExpiry(),
      };

      await this.prisma.otp.create({
        data: otpPayload,
      });
      await sendSMS(
        user.phone,
        `Use this code ${otp} to disable multifactor authentication on your account`,
      );
      return { success: true };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFA: set_2fa },
    });

    return { success: true };
  }

  async verifyPhone(req: RequestWithUserRole) {
    const userDetails = req['user'];
    const user = await this.prisma.user.findUnique({
      where: { id: userDetails.sub },
    });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    if (user.isPhoneVerified) {
      return { success: true };
    }
    const otp = generateOTP(6);
    const otpPayload: Prisma.OtpUncheckedCreateInput = {
      userId: user.id,
      code: otp,
      useCase: 'PHV',
      expiresAt: getExpiry(),
    };

    await this.prisma.otp.create({
      data: otpPayload,
    });
    await sendSMS(
      user.phone,
      `Use this code ${otp} to verify the phone number registered on your account`,
    );
    return { success: true };
  }

  async validatePhoneVerification(req: RequestWithUserRole) {
    const {
      body: { token },
    } = req;
    const userDetails = req['user'];

    const otpRecord = await this.prisma.otp.findFirst({
      where: { code: token, useCase: 'PHV', userId: userDetails.sub },
    });
    if (!otpRecord) {
      throw new HttpException('Invalid OTP', HttpStatus.NOT_FOUND);
    }

    const isExpired = isTokenExpired(otpRecord.expiresAt);
    if (isExpired) {
      throw new HttpException('Expired token', HttpStatus.NOT_FOUND);
    }

    await this.prisma.user.update({
      where: { id: userDetails.sub },
      data: { isPhoneVerified: true },
    });

    await this.prisma.otp.delete({ where: { id: otpRecord.id } });
    return { success: true };
  }

  async disable2FAVerification(req: RequestWithUserRole) {
    const {
      body: { token },
    } = req;
    const userDetails = req['user'];
    const otpRecord = await this.prisma.otp.findFirst({
      where: { code: token, useCase: 'D2FA', userId: userDetails.sub },
    });
    if (!otpRecord) {
      throw new HttpException('Invalid OTP', HttpStatus.NOT_FOUND);
    }
    const isExpired = isTokenExpired(otpRecord.expiresAt);
    if (isExpired) {
      throw new HttpException('Expired token', HttpStatus.NOT_FOUND);
    }
    await this.prisma.user.update({
      where: { id: userDetails.sub },
      data: { twoFA: false },
    });

    await this.prisma.otp.delete({ where: { id: otpRecord.id } });
    return { success: true };
  }

  async getUserInfo(req: RequestWithUserRole) {
    const userDetails = req['user'];

    const user = await this.prisma.user.findUnique({
      where: { id: userDetails.sub },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    return {
      success: true,
      user: _.omit(user, 'password', 'otp'),
    };
  }
}
