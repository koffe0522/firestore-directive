import {
  GraphQLFieldConfig,
  GraphQLSchema,
  TypeNode,
} from 'graphql';
import { mapSchema, getDirective, MapperKind } from '@graphql-tools/utils';
import { CustomError } from './exceptions';
import { getFieldsWithDirective, schemaSerializer } from './serializer';

type FirestoreDirectiveFieldConfig = GraphQLFieldConfig<
  Record<string, unknown>,
  { providers: { name: string; app: FirebaseFirestore.Firestore }[] }
>;

type Model = {
  name: string;
  path: string;
  data: Record<string, Data>;
};

type Data = {
  field: string;
  type: string;
  kind: string;
  directives: string[];
};

const scalars = ['String', 'ID', 'Int', 'Float', 'Boolean'];
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  Any: unknown;
  DateTime: unknown;
};

function getDoc(directiveName: string) {
  const typeDirectiveArgumentMaps: Record<string, Record<string, unknown>> = {};
  const typeDirectiveMaps: Record<string, Model> = {};
  return {
    getDocDirectiveTypeDefs: `directive @${directiveName} on FIELD_DEFINITION`,
    getDocDirective: (schema: GraphQLSchema) =>
      mapSchema(schema, {
        [MapperKind.OBJECT_FIELD]: (
          fieldConfig: FirestoreDirectiveFieldConfig,
          fieldName,
          typeName
        ) => {
          const directive = getDirective(
            schema,
            fieldConfig,
            directiveName
          )?.[0];
          if (!directive) {
            return fieldConfig;
          }

          fieldConfig.resolve = async (source, args, context, info) => {
            const firestore = context?.providers.find(
              (provider) => provider.name === 'gcp-firestore'
            );
            if (!firestore) {
              throw new CustomError(
                'firestore does not exist in context.',
                500
              );
            }

            const argsWithDirective = fieldConfig.astNode?.arguments
              ?.map((input) => {
                if (
                  input.directives?.find(
                    (value) => value.name.value === 'pathID'
                  )
                ) {
                  return input.name.value;
                }

                return '';
              })
              .filter(Boolean);

            if (/^\[/.test(info.returnType.toString())) {
              // NOTE: When the return type is List type.
              const returnType = info.returnType
                .toString()
                .replace(/!/g, '')
                .replace(/^\[/, '')
                .replace(/]$/, '');
              const returnTypeInfo = typeDirectiveMaps[returnType];
              const docPath = argsWithDirective
                ? argsWithDirective.reduce((path, arg) => {
                  const reg = `{${arg}}`;
                  return path.replace(new RegExp(reg), args[arg]);
                }, returnTypeInfo.path)
                : returnTypeInfo.path;

              const snap = await firestore.app.collection(docPath).get();
              if (snap.empty) {
                return [];
              }

              const withDirectiveFields = getFieldsWithDirective(
                schema,
                returnType
              );

              return snap.docs
                .map((doc) => schemaSerializer(withDirectiveFields, doc))
                .filter(Boolean);
            } else {
              const returnTypeInfo =
                typeDirectiveMaps[info.returnType.toString().replace(/!/g, '')];
              if (
                returnTypeInfo.data.documentID.field &&
                args[returnTypeInfo.data.documentID.field]
              ) {
                const path = `${returnTypeInfo.path}/${args[returnTypeInfo.data.documentID.field]
                  }`;
                const snap = await firestore.app.doc(path).get();
                if (!snap.exists) {
                  return {};
                }

                const withDirectiveFields = getFieldsWithDirective(
                  schema,
                  info.returnType.toString()
                );
                const result = schemaSerializer(withDirectiveFields, snap);
                return result ?? snap.data();
              }
            }
          };
          return fieldConfig;
        },
        [MapperKind.TYPE]: (type, schema) => {
          const directive = getDirective(schema, type, 'collection')?.[0];
          if (directive) {
            typeDirectiveArgumentMaps[type.name] = directive;

            if (
              type.astNode?.kind === 'ObjectTypeDefinition' &&
              type.astNode.fields
            ) {
              const data = type.astNode.fields.reduce<Record<string, Data>>(
                (obj, field) => {
                  const directives = field.directives
                    ? field.directives.map((value) => value.name.value)
                    : [];
                  obj[field.name.value] = {
                    field: field.name.value,
                    kind: field.type.kind,
                    directives,
                    type: getTypename(field.type),
                  };

                  if (directives.includes('documentID')) {
                    obj['documentID'] = {
                      field: field.name.value,
                      kind: 'documentID',
                      directives,
                      type: getTypename(field.type),
                    };
                  }

                  return obj;
                },
                {}
              );

              typeDirectiveMaps[type.name] = {
                name: type.name,
                path: directive?.path,
                data: data,
              };
            }
          }
          return undefined;
        },
      }),
  };
}

const getTypename = (typeNode: TypeNode) => {
  switch (typeNode.kind) {
    case 'NamedType':
      return typeNode.name.value;
    case 'ListType':
      return typeNode.type.kind === 'NamedType'
        ? typeNode.type.name.value
        : 'Any';
    case 'NonNullType':
      return 'Any';
    default:
      return 'Any';
  }
};

const { getDocDirective, getDocDirectiveTypeDefs } = getDoc('getDoc');

export { getDocDirective, getDocDirectiveTypeDefs };
