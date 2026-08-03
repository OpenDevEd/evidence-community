import { Fragment } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import rehypeReact from "rehype-react";
import { unified } from "unified";
import { parseSanitizedZoteroMarkup } from "./zoteroMarkup";

const reactCompiler = unified().use(rehypeReact, { Fragment, jsx, jsxs });

export function renderZoteroMarkup(markup: string): React.ReactNode {
	return reactCompiler.stringify(
		parseSanitizedZoteroMarkup(markup),
	) as React.ReactNode;
}
