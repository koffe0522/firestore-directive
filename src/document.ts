import { GraphQLFieldConfig, GraphQLSchema } from 'graphql';
import { mapSchema, getDirective, MapperKind } from '@graphql-tools/utils';
import * as admin from 'firebase-admin';
import { CustomError } from './exceptions';
import { escapeRegExp } from './utils';

type FirestoreDirectiveFieldConfig = GraphQLFieldConfig<
  Record<string, unknown>,
  { providers: { name: string; app: FirebaseFirestore.Firestore }[] }
>;
type WithDirectiveFields =
  | { fieldName: string; directives: string[] | undefined }[]
  | undefined;

const getFieldsWithDirective = (
  schema: GraphQLSchema,
  typeName: string
): WithDirectiveFields => {
  let withDirectiveField: WithDirectiveFields;
  const replacedtypeName = typeName
    .replace(new RegExp(escapeRegExp('[')), '')
    .replace(new RegExp(escapeRegExp(']')), '');
  const returnTypeNode = schema.getType(replacedtypeName)?.astNode;

  if (returnTypeNode?.kind === 'ObjectTypeDefinition') {
    withDirectiveField = returnTypeNode.fields
      ?.filter((field) => !!field.directives?.length)
      ?.map((field) => {
        return {
          fieldName: field.name.value,
          directives: field.directives?.map(
            (directive) => directive.name.value
          ),
        };
      });
  }

  return withDirectiveField;
};

const doContentsOfDirective = (
  withDirectiveFields: WithDirectiveFields,
  doc: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>
) =>
  withDirectiveFields?.reduce(
    (data, field) => {
      if (!field.directives?.length) {
        return data;
      }

      let mergeObject = {};

      if (field.directives?.includes('documentID')) {
        mergeObject = {
          ...mergeObject,
          [field.fieldName]: doc.id,
        };
      }

      if (field.directives?.includes('timestamp')) {
        mergeObject = {
          ...mergeObject,
          [field.fieldName]: data[field.fieldName]
            ? (data[field.fieldName] as admin.firestore.Timestamp).toDate()
            : null,
        };
      }

      return {
        ...data,
        ...mergeObject,
      };
    },
    { ...doc.data() }
  );

function getDoc(directiveName: string) {
  const typeDirectiveArgumentMaps: Record<string, Record<string, unknown>> = {};
  return {
    getDocDirectiveTypeDefs: `directive @${directiveName}(path: String) on FIELD_DEFINITION`,
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
            return;
          }
          const { path } = directive;

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

            if (typeof path !== 'string') {
              throw new CustomError(
                'Invalid getDoc argument parameter.',
                500
              );
            }

            const docPath = Object.entries(args).reduce((str, [k, v]) => {
              const reg = `{${k}}`;
              if (str) {
                return str.replace(new RegExp(reg), v);
              }

              return path.replace(new RegExp(reg), v);
            }, '');

            const snap = await firestore.app.doc(docPath).get();
            if (!snap.exists) {
              return {};
            }

            const withDirectiveFields = getFieldsWithDirective(
              schema,
              info.returnType.toString()
            );
            const result = doContentsOfDirective(withDirectiveFields, snap);
            return result ?? snap.data();
          };
          return fieldConfig;
        },
        [MapperKind.TYPE]: (type) => {
          const directive = getDirective(schema, type, 'collection')?.[0];
          if (directive) {
            typeDirectiveArgumentMaps[type.name] = directive;
          }
          return undefined;
        },
      }),
  };
}

function getDocs(directiveName: string) {
  return {
    getDocsDirectiveTypeDefs: `directive @${directiveName}(path: String) on FIELD_DEFINITION`,
    getDocsDirective: (schema: GraphQLSchema) =>
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
            return;
          }
          const { path } = directive;

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

            if (typeof path !== 'string') {
              throw new CustomError('Invalid getDocs argument parameter.', 500);
            }

            const docPath = Object.keys(args).length
              ? Object.entries(args).reduce((str, [k, v]) => {
                const reg = `{${k}}`;
                if (str) {
                  return str.replace(new RegExp(reg), v);
                }

                return path.replace(new RegExp(reg), v);
              }, '')
              : path;

            const snap = await firestore.app.collection(docPath).get();
            if (snap.empty) {
              return [];
            }

            const withDirectiveFields = getFieldsWithDirective(
              schema,
              info.returnType.toString()
            );

            return snap.docs
              .map((doc) => doContentsOfDirective(withDirectiveFields, doc))
              .filter(Boolean);
          };
          return fieldConfig;
        },
      }),
  };
}

const { getDocDirective, getDocDirectiveTypeDefs } = getDoc('getDoc');
const { getDocsDirective, getDocsDirectiveTypeDefs } = getDocs('getDocs');
export {
  getDocDirective,
  getDocDirectiveTypeDefs,
  getDocsDirective,
  getDocsDirectiveTypeDefs,
};
