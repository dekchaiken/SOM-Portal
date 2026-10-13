import { describe, expect, it } from 'vitest';
import { wrapEmailHtml } from './branding';

describe('wrapEmailHtml', () => {
  it('puts the footer lines on separate rows, escaped', () => {
    const html = wrapEmailHtml('<p>x</p>', 'S', { footerText: 'SMC: 091-696-9885\nBy <b>Team</b>' });
    expect(html).toContain('SMC: 091-696-9885<br>By &lt;b&gt;Team&lt;/b&gt;');
    expect(html).not.toContain('By <b>Team</b>');
  });
  it('shows the header text under the app name', () => {
    const html = wrapEmailHtml('', 'S', { appName: 'Ascend SM', headerText: 'Service Monitoring Center' });
    expect(html).toContain('Ascend SM · Service Monitoring Center');
  });
  it('falls back to the default footer when none is set', () => {
    expect(wrapEmailHtml('', 'S', { appName: 'SOM' })).toContain('SOM - Service Operations Management');
  });
  it('uses the brand colour on the top border', () => {
    expect(wrapEmailHtml('', 'S', { brandColor: '#123456' })).toContain('border-top:4px solid #123456');
  });
});
