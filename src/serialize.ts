import {BYTE, LEN, SHORT, STRING, TSerializer} from "./serializePrimitives";
import {concat} from "./libs/utils";
import {orderSchemaV0, orderSchemaV2, getTransactionSchema} from "./schemas";
import {TSchema} from "./schemaTypes";

export type TFromLongConverter<LONG> = (v: LONG) => string;

/**
 * Creates js to bytes converter for object from given schema
 * @param schema
 * @param fromLongConverter
 */
// FixMe: currently fromLongConverter does nothing. Maybe we should remove it altogether
export const serializerFromSchema = <LONG = string | number>(schema: TSchema, fromLongConverter?: TFromLongConverter<LONG>): TSerializer<any> => (obj: any) => {
  //let result = Uint8Array.from([]);

  let serializer: TSerializer<any>,
    itemBytes: Uint8Array;

  if (schema.type === 'array') {
    serializer = serializerFromSchema(schema.items, fromLongConverter);
    itemBytes = concat(...obj.map((item: any) => serializer((item))));
    return concat((schema.toBytes || SHORT)(obj.length), itemBytes);
  }
  else if (schema.type === 'object') {
    let objBytes = Uint8Array.from([]);

    if (schema.optional && obj == null) {
      return Uint8Array.from([0])
    }

    schema.schema.forEach(field => {
      const [name, schema] = field;
      serializer = serializerFromSchema(schema, fromLongConverter);
      itemBytes = serializer(obj[name]);
      objBytes = concat(objBytes, itemBytes);
    });

    if (schema.withLength){
      const l = schema.withLength.toBytes(objBytes.length)
      objBytes = concat(l, objBytes);
    }
    if (schema.optional) objBytes = concat([1], objBytes);

    return objBytes
  }
  else if (schema.type === 'anyOf') {
    const type = obj[schema.discriminatorField];
    const anyOfItem = schema.itemByKey(type);

    if (anyOfItem == null) {
      throw new Error(`Serializer Error: Unknown anyOf type: ${type}`)
    }

    serializer = serializerFromSchema(anyOfItem.schema, fromLongConverter);

    // If object should be serialized as is. E.g.  {type: 20, signature, '100500'}
    if (schema.valueField == null){
      return serializer(obj)
    // Otherwise we serialize field and write discriminator. Eg. {type: 'integer', value: 10000}
    }else {
      itemBytes = serializer(obj[schema.valueField]);
      return concat((schema.toBytes || BYTE)(anyOfItem.key), itemBytes);
    }
  }
  else if (schema.type === 'primitive' || schema.type === undefined) {
    return schema.toBytes(obj);
  }
  else if (schema.type === 'dataTxField') {
    const keyBytes = LEN(SHORT)(STRING)(obj.key);
    const type = obj.type;
    const typeSchema = schema.items.get(type);
    if (typeSchema == null) {
      throw new Error(`Serializer Error: Unknown dataTxField type: ${type}`)
    }
    const typeCode = [...schema.items.values()].findIndex(schema => schema === typeSchema);
    serializer = serializerFromSchema(typeSchema, fromLongConverter);
    itemBytes = serializer(obj.value);
    return concat(keyBytes, BYTE(typeCode), itemBytes)
  } else {
    throw new Error(`Serializer Error: Unknown schema type: ${schema!.type}`)
  }

};

export function serializeTx<LONG = string | number>(tx: any, fromLongConverter?: TFromLongConverter<LONG>): Uint8Array {
  const {type, version} = tx;
  const schema = getTransactionSchema(type, version);

  return serializerFromSchema(schema, fromLongConverter)(tx);
}

export function serializeOrder<LONG = string | number>(ord: any, fromLongConverter?: TFromLongConverter<LONG>): Uint8Array {
  const {version} = ord;
  const schema = version == 2 ? orderSchemaV2 : orderSchemaV0;
  return serializerFromSchema(schema, fromLongConverter)(ord);
}