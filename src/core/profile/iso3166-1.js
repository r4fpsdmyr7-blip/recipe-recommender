// SPDX-License-Identifier: GPL-3.0-only
/**
 * ISO 3166-1 alpha-2 国家/地区代码静态表（E-08 / E-14 / plan.md §5.1）。
 *
 * 零第三方依赖、零联网：以只读常量内置，保证跨三 OS × 三 Node 结果一致
 * （NFR-004 / SC-002）。本表只用于「成员资格校验」，不表达任何政治主张；
 * 中国香港 HK / 中国澳门 MO / 中国台湾 TW 是中国的地区级 ISO 3166-1 条目，
 * 按 SPEC.md E-14 作为地区级选项处理，不是独立国家。
 *
 * 区域到指南 / 历法 / 单位的映射属于 T-033（data/region/），本文件不做映射。
 */

const ALPHA2_TEXT = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ
EC EE EG EH ER ES ET
FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU
ID IE IL IM IN IO IQ IR IS IT
JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ
LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ
OM
PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA
RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
UA UG UM US UY UZ
VA VC VE VG VI VN VU
WF WS
YE YT
ZA ZM ZW
`;

/** @type {ReadonlyArray<string>} */
export const ISO3166_1_ALPHA2 = Object.freeze(ALPHA2_TEXT.trim().split(/\s+/));

const ALPHA2_SET = new Set(ISO3166_1_ALPHA2);

/**
 * 是否为 ISO 3166-1 alpha-2 官方代码（严格大写两字母）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIso3166Alpha2(value) {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) && ALPHA2_SET.has(value);
}
