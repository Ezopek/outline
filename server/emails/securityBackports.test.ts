import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import * as React from "react";
import { DocumentConverter } from "@server/converters/DocumentConverter";
import env from "@server/env";
import { Mailer } from "./mailer";

const requirePackage = createRequire(import.meta.url);
const mailparserRequire = createRequire(requirePackage.resolve("mailparser"));
const intended = "visible@example.test";
const recipients = [
  [
    `Victim (x(y) <hidden@other.example>) <${intended}>`,
    [intended],
    [intended],
  ],
  [`G: (a; <hidden@other.example>) <${intended}>;`, [intended], [intended]],
  // MIME parsing preserves the quoted local part. Both the old and patched
  // composer's existing address normalizer replace angle brackets with spaces;
  // the security requirement is that the final domain remains example.test.
  [
    '<"a@other.example>"@example.test>',
    ['"a@other.example>"@example.test'],
    ['"a@other.example "@example.test'],
  ],
  [
    '"Doe, Alice" <alice@example.test>, bob@example.test',
    ["alice@example.test", "bob@example.test"],
    ["alice@example.test", "bob@example.test"],
  ],
] as const;

describe("separately qualified Nodemailer backport", () => {
  it("resolves both root and mailparser's exact dependency edge to 10.1.4", () => {
    expect(requirePackage("nodemailer/package.json").version).toBe("10.1.4");
    expect(mailparserRequire("nodemailer/package.json").version).toBe("10.1.4");
    expect(mailparserRequire.resolve("nodemailer")).toBe(
      requirePackage.resolve("nodemailer")
    );
  });

  it.each(recipients)(
    "canonicalizes %s in MIME import and offline envelopes",
    async (to, expected, envelope) => {
      const parsed = await simpleParser(
        `From: sender@example.test\r\nTo: ${to}\r\nSubject: Control\r\n\r\nBody`
      );
      const headers = Array.isArray(parsed.to)
        ? parsed.to
        : parsed.to
          ? [parsed.to]
          : [];
      expect(
        headers.flatMap((header) =>
          header.value
            .flatMap((value) => value.group ?? [value])
            .map((value) => value.address)
        )
      ).toEqual(expected);
      const transport = nodemailer.createTransport({ jsonTransport: true });
      try {
        const info = await transport.sendMail({
          from: "sender@example.test",
          to,
          subject: "Control",
          text: "Body",
        });
        expect(info.envelope.to).toEqual(envelope);
        expect(JSON.parse(info.message).subject).toBe("Control");
      } finally {
        transport.close();
      }
    }
  );

  it("composes the real Mailer reply headers and logo using a stream transport without SMTP", async () => {
    const cloud = vi.spyOn(env, "isCloudHosted", "get").mockReturnValue(false);
    const mailer = new Mailer();
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    const send = vi.spyOn(transport, "sendMail");
    mailer.transporter = transport;
    try {
      await mailer.sendMail({
        from: { name: "Sender", address: "sender@example.test" },
        to: intended,
        replyTo: "reply@example.test",
        messageId: "<message@example.test>",
        references: ["<first@example.test>", "<previous@example.test>"],
        subject: "Re: Control",
        text: "Synthetic body",
        component: React.createElement("p", null, "Synthetic body"),
      });
      expect(send).toHaveBeenCalledTimes(1);
      const info = await send.mock.results[0].value;
      expect(info.envelope.to).toEqual([intended]);
      const parsed = await simpleParser(info.message);
      expect(parsed.messageId).toBe("<message@example.test>");
      expect(parsed.inReplyTo).toBe("<previous@example.test>");
      expect(parsed.references).toEqual([
        "<first@example.test>",
        "<previous@example.test>",
      ]);
      expect(parsed.replyTo?.value[0].address).toBe("reply@example.test");
      expect(parsed.text).toContain("Synthetic body");
      expect(
        parsed.attachments.find(
          (attachment) => attachment.cid === "header-image"
        )?.filename
      ).toBe("header-logo.png");
    } finally {
      cloud.mockRestore();
      send.mockRestore();
      transport.close();
    }
  });

  it("imports synthetic MIME with its subject, inline attachment and normal body intact", async () => {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    try {
      const info = await transport.sendMail({
        from: "sender@example.test",
        to: intended,
        subject: "Imported control",
        html: '<p>Body</p><img src="cid:pixel" alt="pixel">',
        text: "Body",
        attachments: [
          {
            filename: "pixel.png",
            content: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
              "base64"
            ),
            contentType: "image/png",
            cid: "pixel",
          },
        ],
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (!Buffer.isBuffer(info.message)) {
        throw new TypeError("Expected a buffered offline MIME message");
      }
      const result = await DocumentConverter.convert(
        info.message,
        "synthetic.eml",
        "message/rfc822"
      );
      expect(result.title).toBe("Imported control");
      expect(result.text).toContain("Body");
      expect(result.text).toContain("data:image/png;base64,");
    } finally {
      transport.close();
    }
  });

  it("bounds address-list and malformed-header complexity in an offline child process", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--max-old-space-size=128",
        "-e",
        `
      const assert = require('node:assert/strict');
      const { simpleParser } = require('mailparser');
      const nodemailer = require('nodemailer');
      (async () => {
        const transport = nodemailer.createTransport({jsonTransport: true});
        try {
          for (const size of [128, 256, 512]) {
            const to = Array.from({length: size}, (_, i) => 'u' + i + '@example.test').join(',');
            const message = await simpleParser('To: ' + to + '\\r\\n\\r\\nBody');
            assert.equal(message.to.value.length, size);
            const composed = await transport.sendMail({from: 'sender@example.test', to, text: 'Body'});
            assert.equal(composed.envelope.to.length, size);
          }
          const malformed = await simpleParser('To: ' + 'x'.repeat(4096) + '\\r\\n\\r\\nBody');
          assert.equal(malformed.text, 'Body');
          process.stdout.write('bounded offline mail controls passed');
        } finally { transport.close(); }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
      ],
      { timeout: 5000, maxBuffer: 64 * 1024, encoding: "utf8" }
    );
    expect(output).toBe("bounded offline mail controls passed");
  });
});
