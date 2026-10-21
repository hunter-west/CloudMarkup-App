import { readFileSync } from "node:fs";
/** Supported Cognito managed-login settings; colors mirror the shared UI tokens.
 * https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateManagedLoginBranding.html
 */
export function cloudMarkupManagedLoginBranding() {
  const logo = readFileSync(
    new URL(
      "../../../apps/web/src/assets/brand/public/cloudmarkup-logo.png",
      import.meta.url,
    ),
  );
  if (logo.byteLength > 400_000)
    throw Error("The reviewed authentication logo is too large.");
  return {
    useCognitoProvidedValues: false,
    assets: [
      {
        category: "FORM_LOGO",
        colorMode: "LIGHT",
        extension: "PNG",
        bytes: logo.toString("base64"),
      },
    ],
    settings: {
      categories: {
        global: {
          colorSchemeMode: "LIGHT",
          spacingDensity: "REGULAR",
          pageHeader: { enabled: false },
          pageFooter: { enabled: false },
        },
        form: {
          displayGraphics: true,
          location: { horizontal: "CENTER", vertical: "CENTER" },
        },
      },
      componentClasses: {
        buttons: { borderRadius: 8 },
        input: {
          borderRadius: 8,
          lightMode: {
            defaults: { backgroundColor: "ffffffff", borderColor: "8795a8ff" },
          },
          darkMode: {
            defaults: { backgroundColor: "202936ff", borderColor: "75869bff" },
          },
        },
        inputLabel: {
          lightMode: { textColor: "17212bff" },
          darkMode: { textColor: "eef3faff" },
        },
        inputDescription: {
          lightMode: { textColor: "52606dff" },
          darkMode: { textColor: "bac6d6ff" },
        },
        focusState: {
          lightMode: { borderColor: "005fccff" },
          darkMode: { borderColor: "8cbaffff" },
        },
        link: {
          lightMode: {
            defaults: { textColor: "1947b6ff" },
            hover: { textColor: "17212bff" },
          },
          darkMode: {
            defaults: { textColor: "98b8ffff" },
            hover: { textColor: "bed2ffff" },
          },
        },
      },
      components: {
        form: {
          borderRadius: 12,
          backgroundImage: { enabled: false },
          lightMode: { backgroundColor: "ffffffff", borderColor: "cbd5e1ff" },
          darkMode: { backgroundColor: "202936ff", borderColor: "465568ff" },
          logo: {
            enabled: true,
            formInclusion: "IN",
            location: "CENTER",
            position: "TOP",
          },
        },
        pageBackground: {
          image: { enabled: false },
          lightMode: { color: "f7f9fcff" },
          darkMode: { color: "121720ff" },
        },
        pageText: {
          lightMode: {
            bodyColor: "17212bff",
            descriptionColor: "52606dff",
            headingColor: "17212bff",
          },
          darkMode: {
            bodyColor: "eef3faff",
            descriptionColor: "bac6d6ff",
            headingColor: "eef3faff",
          },
        },
        primaryButton: {
          lightMode: {
            defaults: { backgroundColor: "315efbff", textColor: "ffffffff" },
            hover: { backgroundColor: "1947b6ff", textColor: "ffffffff" },
            active: { backgroundColor: "1947b6ff", textColor: "ffffffff" },
          },
          darkMode: {
            defaults: { backgroundColor: "98b8ffff", textColor: "102447ff" },
            hover: { backgroundColor: "bed2ffff", textColor: "102447ff" },
            active: { backgroundColor: "bed2ffff", textColor: "102447ff" },
          },
        },
      },
    },
  };
}
