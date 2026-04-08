export class CreateBuyerRequestDto {
  buyerName!: string;
  contact!: string;
  address!: string;
  detailAddress?: string;
  preferredDateTime!: string;
  desiredPrice?: string;
  additionalMemo?: string;
  source?: string;
  privacyAgreed?: boolean;

  // 프론트에서 carOwner로 보내는 경우도 허용 (폼 필드명 호환)
  carOwner?: string;
}
