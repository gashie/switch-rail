import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { minorUnitsOf } from '../../core/money.js';

const PARSER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  textNodeName: '#text'
};

const BUILDER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
  textNodeName: '#text'
};

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

const xmlParser = new XMLParser(PARSER_OPTS);
const xmlBuilder = new XMLBuilder(BUILDER_OPTS);

export const parseXml = (xml) => xmlParser.parse(xml);

export const buildXml = (obj, { withDeclaration = true } = {}) => {
  const body = xmlBuilder.build(obj);
  return withDeclaration ? XML_DECLARATION + body : body;
};

export const text = (v) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object' && '#text' in v) return v['#text'];
  return v;
};

export const get = (obj, path) =>
  path
    .split('.')
    .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);

export const minorToDecimal = (minorStr, currency) => {
  const m = minorUnitsOf(currency);
  if (m === 0) return String(minorStr);
  const padded = String(minorStr).padStart(m + 1, '0');
  return `${padded.slice(0, -m)}.${padded.slice(-m)}`;
};

export const decimalToMinor = (decimal, currency) => {
  const m = minorUnitsOf(currency);
  const s = String(decimal).trim();
  if (m === 0) {
    if (!/^\d+$/.test(s)) {
      throw new Error(`amount ${s} not integer for ${currency} (${m}-decimal)`);
    }
    return s;
  }
  const re = new RegExp(`^(\\d+)(?:\\.(\\d{1,${m}}))?$`);
  const match = s.match(re);
  if (!match) {
    throw new Error(`amount ${s} exceeds ${currency} precision (max ${m} decimals)`);
  }
  const major = match[1];
  const frac = (match[2] || '').padEnd(m, '0');
  return BigInt(major + frac).toString();
};

export const compactObject = (obj) => {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    const arr = obj.map(compactObject).filter((v) => v !== undefined);
    return arr.length === 0 ? undefined : arr;
  }
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      const v = compactObject(obj[k]);
      if (v !== undefined && v !== '') out[k] = v;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return obj;
};

export const ISO20022_NAMESPACES = Object.freeze({
  pacs008: 'urn:iso:std:iso:20022:tech:xsd:pacs.008.001.14',
  pacs002: 'urn:iso:std:iso:20022:tech:xsd:pacs.002.001.16',
  pacs004: 'urn:iso:std:iso:20022:tech:xsd:pacs.004.001.15',
  pacs007: 'urn:iso:std:iso:20022:tech:xsd:pacs.007.001.14',
  camt056: 'urn:iso:std:iso:20022:tech:xsd:camt.056.001.11'
});
