import { describe, expect, it } from 'vitest';
import {
  formatTelegramHtml,
  prepareTelegramReply,
  splitTelegramHtml,
  stripTelegramHtml,
  TELEGRAM_MESSAGE_LIMIT,
} from './telegram-format.js';

describe('formatTelegramHtml', () => {
  it('converte titoli, enfasi, codice inline e barrato', () => {
    const html = formatTelegramHtml('# Titolo\n\n**grassetto** e *corsivo* e ~~barrato~~ e `code`');
    expect(html).toBe('<b>Titolo</b>\n\n<b>grassetto</b> e <i>corsivo</i> e <s>barrato</s> e <code>code</code>');
  });

  it('escapa sempre l’HTML proveniente dal modello', () => {
    const html = formatTelegramHtml('<script>alert("x")</script> & <b>non fidato</b>');
    expect(html).toBe('&lt;script&gt;alert("x")&lt;/script&gt; &amp; &lt;b&gt;non fidato&lt;/b&gt;');
  });

  it('converte i link e scarta protocolli non sicuri', () => {
    expect(formatTelegramHtml('[OpenAI](https://example.com/a?b=1&c=2)')).toBe(
      '<a href="https://example.com/a?b=1&amp;c=2">OpenAI</a>',
    );
    expect(formatTelegramHtml('[male](javascript:alert)')).toBe('male');
  });

  it('converte i blocchi di codice con linguaggio e senza interpretare il contenuto', () => {
    const html = formatTelegramHtml('```js\nconst x = 1 < 2 && true;\n```');
    expect(html).toBe('<pre><code class="language-js">const x = 1 &lt; 2 &amp;&amp; true;</code></pre>');
  });

  it('chiude un blocco di codice non terminato', () => {
    const html = formatTelegramHtml('```\nriga uno\nriga due');
    expect(html).toBe('<pre><code>riga uno\nriga due</code></pre>');
  });

  it('permette fence più lunghe per includere triple backtick nel codice', () => {
    const html = formatTelegramHtml('````\n```\n````');
    expect(html).toBe('<pre><code>```</code></pre>');
  });

  it('converte le tabelle GFM in elenchi leggibili', () => {
    const html = formatTelegramHtml('| Nome | Età |\n| --- | --- |\n| Ada | 36 |\n| Bob | 40 |');
    expect(html).toBe(
      '• <b>Nome</b>: Ada · <b>Età</b>: 36\n• <b>Nome</b>: Bob · <b>Età</b>: 40',
    );
  });

  it('gestisce liste, task list, citazioni e righe orizzontali', () => {
    const html = formatTelegramHtml('- uno\n- due\n  - annidato\n\n1. primo\n2. secondo\n\n- [x] fatto\n- [ ] da fare\n\n> citazione\n\n---');
    expect(html).toContain('• uno\n• due\n  • annidato');
    expect(html).toContain('1. primo\n2. secondo');
    expect(html).toContain('☑ fatto\n☐ da fare');
    expect(html).toContain('<blockquote>citazione</blockquote>');
    expect(html).toContain('────────');
  });

  it('non interpreta Markdown dentro il codice', () => {
    expect(formatTelegramHtml('`**non bold**`')).toBe('<code>**non bold**</code>');
    expect(formatTelegramHtml('```\n**non bold**\n```')).toBe('<pre><code>**non bold**</code></pre>');
  });

  it('restituisce una stringa vuota per input vuoto', () => {
    expect(formatTelegramHtml('   \n\n')).toBe('');
  });
});

describe('splitTelegramHtml', () => {
  it('divide testo lungo senza superare il limite', () => {
    const text = 'parola '.repeat(1_000).trim();
    const chunks = splitTelegramHtml(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
    expect(chunks.map(stripTelegramHtml).join(' ').replace(/\s+/g, ' ').trim()).toBe(text);
  });

  it('chiude e riapre i tag di enfasi ai confini', () => {
    const html = formatTelegramHtml(`**${'parola '.repeat(500).trim()}**`);
    const chunks = splitTelegramHtml(html, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('<b>')).toBe(true);
      expect(chunk.endsWith('</b>')).toBe(true);
      expect(chunk.length).toBeLessThanOrEqual(120);
    }
  });

  it('chiude e riapre i blocchi di codice senza tagliare i tag', () => {
    const html = formatTelegramHtml(`\`\`\`\n${'riga di codice\n'.repeat(300)}\`\`\``);
    const chunks = splitTelegramHtml(html, 140);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('<pre><code>')).toBe(true);
      expect(chunk.endsWith('</code></pre>')).toBe(true);
      expect(chunk.length).toBeLessThanOrEqual(140);
    }
  });

  it('non spezza i link a metà', () => {
    const html = formatTelegramHtml(`[${'etichetta '.repeat(200).trim()}](https://example.com)`);
    const chunks = splitTelegramHtml(html, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect((chunk.match(/<a /g) ?? []).length).toBe(1);
      expect((chunk.match(/<\/a>/g) ?? []).length).toBe(1);
    }
  });

  it('bilanciati tag annidati su ogni blocco', () => {
    const html = formatTelegramHtml(`**${'testo con [link](https://example.com) e `codice` '.repeat(100).trim()}**`);
    const chunks = splitTelegramHtml(html, 160);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect((chunk.match(/<b>/g) ?? []).length).toBe((chunk.match(/<\/b>/g) ?? []).length);
      expect((chunk.match(/<a /g) ?? []).length).toBe((chunk.match(/<\/a>/g) ?? []).length);
      expect((chunk.match(/<code>/g) ?? []).length).toBe((chunk.match(/<\/code>/g) ?? []).length);
      expect(chunk.length).toBeLessThanOrEqual(160);
    }
  });

  it('non spezza le entità HTML', () => {
    const chunks = splitTelegramHtml('&amp; '.repeat(100), 70);
    for (const chunk of chunks) {
      expect(chunk.endsWith('&')).toBe(false);
      expect(chunk.startsWith('mp;')).toBe(false);
      expect(chunk.startsWith(';')).toBe(false);
    }
  });

  it('rispetta il limite reale di Telegram', () => {
    const html = formatTelegramHtml('testo '.repeat(2_000));
    for (const chunk of splitTelegramHtml(html)) expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it('restituisce un array vuoto per HTML vuoto', () => {
    expect(splitTelegramHtml('   ')).toEqual([]);
  });
});

describe('prepareTelegramReply', () => {
  it('restituisce solo i blocchi per una risposta breve', () => {
    const reply = prepareTelegramReply('**Ciao**');
    expect(reply.chunks).toEqual(['<b>Ciao</b>']);
    expect(reply.document).toBeUndefined();
  });

  it('allega il Markdown completo quando i blocchi sono troppi', () => {
    const markdown = 'parola '.repeat(10_000).trim();
    const reply = prepareTelegramReply(markdown, { limit: 200, maxChunks: 2, filename: 'Report finale.pdf' });
    expect(reply.chunks).toHaveLength(2);
    expect(reply.document).toMatchObject({ filename: 'Report-finale.md', mimeType: 'text/markdown' });
    expect(reply.document?.buffer.toString('utf8')).toBe(markdown);
  });

  it('non produce documenti per una risposta vuota', () => {
    expect(prepareTelegramReply('   ')).toEqual({ chunks: [] });
  });
});

describe('stripTelegramHtml', () => {
  it('ripristina il testo leggibile', () => {
    expect(stripTelegramHtml('<b>Ciao</b> &amp; <code>a &lt; b</code><blockquote>x</blockquote>')).toBe(
      'Ciao & a < b\nx\n',
    );
  });
});
