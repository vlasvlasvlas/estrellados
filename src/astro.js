const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrap360(degrees) {
  let value = degrees % 360;
  if (value < 0) {
    value += 360;
  }
  return value;
}

function wrap180(degrees) {
  let value = wrap360(degrees);
  if (value > 180) {
    value -= 360;
  }
  return value;
}

function toJulianDate(date) {
  return (date.getTime() / 86400000) + 2440587.5;
}

function localSiderealTimeDeg(date, longitudeDeg) {
  const jd = toJulianDate(date);
  const t = (jd - 2451545.0) / 36525.0;
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000;
  return wrap360(gmst + longitudeDeg);
}

function spectralBaseType(spectral) {
  const value = (spectral || "G").trim().toUpperCase();
  return value[0] || "G";
}

export function getObservationDate(mode, offset, baseDate = new Date()) {
  if (mode === "24h") {
    return new Date(baseDate.getTime() + (Number(offset) || 0) * 3600000);
  }
  if (mode === "seasonal") {
    return new Date(baseDate.getTime() + (Number(offset) || 0) * 86400000);
  }
  return baseDate;
}

export function equatorialToHorizontal(star, date, latitudeDeg, longitudeDeg) {
  const latRad = latitudeDeg * DEG_TO_RAD;
  const decRad = star.decDeg * DEG_TO_RAD;
  const raDeg = star.raHours * 15;

  const lstDeg = localSiderealTimeDeg(date, longitudeDeg);
  const hourAngleRad = wrap180(lstDeg - raDeg) * DEG_TO_RAD;

  const sinAlt =
    Math.sin(decRad) * Math.sin(latRad) +
    Math.cos(decRad) * Math.cos(latRad) * Math.cos(hourAngleRad);

  const altitudeRad = Math.asin(clamp(sinAlt, -1, 1));

  const y = -Math.sin(hourAngleRad);
  const x =
    Math.tan(decRad) * Math.cos(latRad) -
    Math.sin(latRad) * Math.cos(hourAngleRad);

  const azimuthDeg = wrap360(Math.atan2(y, x) * RAD_TO_DEG);

  return {
    altitudeDeg: altitudeRad * RAD_TO_DEG,
    azimuthDeg
  };
}

export function collectVisibleStars(catalog, date, latitudeDeg, longitudeDeg, minAltitudeDeg = 0) {
  const stars = [];

  for (const star of catalog) {
    const horizontal = equatorialToHorizontal(star, date, latitudeDeg, longitudeDeg);
    if (horizontal.altitudeDeg >= minAltitudeDeg) {
      stars.push({
        ...star,
        altitudeDeg: horizontal.altitudeDeg,
        azimuthDeg: horizontal.azimuthDeg
      });
    }
  }

  stars.sort((a, b) => a.mag - b.mag);
  return stars;
}

export function starToSoundProfile(star) {
  const brightness = clamp((2.5 - star.mag) / 4.5, 0.06, 1);
  const distanceNorm = clamp(Math.log10((star.distanceLy || 10) + 1) / 4, 0, 1);
  const altitudeNorm = clamp((star.altitudeDeg + 5) / 95, 0, 1);

  return {
    brightness,
    distanceNorm,
    altitudeNorm,
    spectralType: spectralBaseType(star.spectral),
    pan: clamp((star.azimuthDeg / 180) - 1, -1, 1),
    baseFreq: 55 * Math.pow(2, 3 * altitudeNorm),
    harmonicBrightness: clamp(1 - (star.bv + 0.4) / 2.4, 0, 1)
  };
}
