import { GraphQLSchema } from 'graphql';
import * as admin from 'firebase-admin';
import { escapeRegExp } from './utils';

type WithDirectiveFields =
  | { fieldName: string; directives: string[] | undefined }[]
  | undefined;

export const schemaSerializer = (
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

export const getFieldsWithDirective = (
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
