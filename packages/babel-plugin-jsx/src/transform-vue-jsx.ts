import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';
import { addDefault } from '@babel/helper-module-imports';
import {
  createIdentifier,
  transformJSXSpreadChild,
  transformJSXText,
  transformJSXExpressionContainer,
  walksScope,
  JSX_HELPER_KEY,
} from './utils';
import buildProps from './buildProps';
import { PatchFlags } from './patchFlags';
import { State, ExcludesBoolean } from '.';

/**
 * Get children from Array of JSX children
 * @param paths Array<JSXText | JSXExpressionContainer  | JSXElement | JSXFragment>
 * @returns Array<Expression | SpreadElement>
 */
const getChildren = (
  paths: NodePath<
    t.JSXText
      | t.JSXExpressionContainer
      | t.JSXSpreadChild
      | t.JSXElement
      | t.JSXFragment
    >[],
  state: State,
): t.Expression[] => paths
  .map((path) => {
    if (path.isJSXText()) {
      const transformedText = transformJSXText(path);
      if (transformedText) {
        return t.callExpression(createIdentifier(path, state, 'createTextVNode'), [transformedText]);
      }
      return transformedText;
    }
    if (path.isJSXExpressionContainer()) {
      const expression = transformJSXExpressionContainer(path);

      if (t.isIdentifier(expression)) {
        const { name } = expression as t.Identifier;
        const { referencePaths = [] } = path.scope.getBinding(name) || {};
        referencePaths.forEach((referencePath) => {
          walksScope(referencePath, name);
        });
      }

      return expression;
    }
    if (t.isJSXSpreadChild(path)) {
      return transformJSXSpreadChild(path as NodePath<t.JSXSpreadChild>);
    }
    if (path.isCallExpression()) {
      return path.node;
    }
    if (path.isJSXElement()) {
      return transformJSXElement(path, state);
    }
    throw new Error(`getChildren: ${path.type} is not supported`);
  }).filter(((value: any) => (
    value !== undefined
      && value !== null
      && !t.isJSXEmptyExpression(value)
  )) as any);

const transformJSXElement = (
  path: NodePath<t.JSXElement>,
  state: State,
): t.CallExpression => {
  const children = getChildren(path.get('children'), state);
  const {
    tag,
    props,
    isComponent,
    directives,
    patchFlag,
    dynamicPropNames,
    slots,
  } = buildProps(path, state);

  const useOptimate = path.getData('optimize') !== false;

  const { compatibleProps = false, optimize = false } = state.opts;
  if (compatibleProps && !state.get('compatibleProps')) {
    state.set('compatibleProps', addDefault(
      path, '@ant-design-vue/babel-helper-vue-compatible-props', { nameHint: '_compatibleProps' },
    ));
  }

  // @ts-ignore
  const createVNode = t.callExpression(createIdentifier(path, state, optimize ? 'createVNode' : 'h'), [
    tag,
    // @ts-ignore
    compatibleProps ? t.callExpression(state.get('compatibleProps'), [props]) : props,
    (children.length || slots) ? (
      isComponent
        ? t.objectExpression([
          !!children.length && t.objectProperty(
            t.identifier('default'),
            t.arrowFunctionExpression([], t.arrayExpression(children)),
          ),
          ...(slots ? (
            t.isObjectExpression(slots)
              ? (slots! as t.ObjectExpression).properties
              : [t.spreadElement(slots!)]
          ) : []),
        ].filter(Boolean as any as ExcludesBoolean))
        : t.arrayExpression(children)
    ) : t.nullLiteral(),
    !!patchFlag && optimize && (
      useOptimate
        ? t.numericLiteral(patchFlag)
        : t.numericLiteral(PatchFlags.BAIL)
    ),
    !!dynamicPropNames.size && optimize
    && t.arrayExpression(
      [...dynamicPropNames.keys()].map((name) => t.stringLiteral(name as string)),
    ),
  ].filter(Boolean as any as ExcludesBoolean));

  if (!directives.length) {
    return createVNode;
  }

  return t.callExpression(createIdentifier(path, state, 'withDirectives'), [
    createVNode,
    t.arrayExpression(directives),
  ]);
};

export { transformJSXElement };

export default () => ({
  JSXElement: {
    exit(path: NodePath<t.JSXElement>, state: State) {
      path.replaceWith(
        transformJSXElement(path, state),
      );
    },
  },
  Program: {
    exit(path:NodePath<t.Program>, state:State) {
      const helpers:Map<string, t.Identifier> = state.get(JSX_HELPER_KEY);
      if (!helpers) {
        return;
      }
      const importedHelperKeys = Array.from(helpers.keys());
      const importedFromVueExpression = path.get('body').filter((innerPath:NodePath<any>) => {
        if (innerPath.isImportDeclaration()) {
          const importSpecifiers = innerPath.get('specifiers') as NodePath<t.ImportSpecifier>[];
          if (importSpecifiers.length > 1) {
            return false;
          }
          const firstSpecifier = importSpecifiers[0];
          if (firstSpecifier.isImportSpecifier()) {
            const imported = firstSpecifier.get('imported').get('name') as NodePath<string>;
            const local = firstSpecifier.get('local').get('name') as NodePath<string>;
            return helpers.get(imported.node)?.name === local.node;
          }
        }
        return false;
      });
      importedFromVueExpression.forEach((exp) => exp.remove());
      const importDeclaration: (t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier)[] = [];
      importedHelperKeys.forEach((imported:string) => {
        const local = helpers.get(imported);
        if (!local) {
          throw Error(`Cannot find specific imports for ${imported}`);
        }
        importDeclaration.push(t.importSpecifier(local, t.identifier(imported)));
      });
      const expression = t.importDeclaration(importDeclaration, t.stringLiteral('vue'));
      path.unshiftContainer('body', expression);
    },
  },
});
