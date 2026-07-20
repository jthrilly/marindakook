export function buildTranslatePrompt(input: {
  template: string;
  styleGuide: string;
  sourceJson: string;
}): string {
  return input.template
    .replaceAll("{{STYLE_GUIDE}}", input.styleGuide)
    .replaceAll("{{SOURCE_JSON}}", input.sourceJson);
}
