/**
 * Cấu hình điểm GPS chuẩn cho tòa nhà mẫu ResiFix
 * Cơ sở: Đại học Duy Tân, Hòa Khánh Nam, 120 Hoàng Minh Thảo, Đà Nẵng
 * Google Maps: https://maps.app.goo.gl/ALhEFADGiyKyFdEB6
 */

export interface BuildingLocationConfig {
  buildingName: string;
  campusName: string;
  buildingAddress: string;
  latitude: number;
  longitude: number;
  allowedRadiusMeters: number;
  googleMapsUrl: string;
  isConfirmed: boolean;
}

export const DEFAULT_BUILDING_LOCATION: BuildingLocationConfig = {
  buildingName: 'Đại học Duy Tân',
  campusName: 'Hòa Khánh Nam',
  buildingAddress: '120 Hoàng Minh Thảo, Hòa Khánh Nam, Đà Nẵng, Việt Nam',
  latitude: 16.0492916,
  longitude: 108.1600966,
  allowedRadiusMeters: 300,
  googleMapsUrl: 'https://maps.app.goo.gl/ALhEFADGiyKyFdEB6',
  isConfirmed: true,
};
