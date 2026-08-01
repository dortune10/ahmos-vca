import { IsIn } from 'class-validator';

export class UpdateReferralStatusDto {
  @IsIn(['Created', 'Sent', 'Accepted', 'Dispatched', 'InTransit', 'Arrived', 'Completed', 'Failed', 'Cancelled'])
  status!: string;
}
