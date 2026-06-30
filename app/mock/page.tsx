import * as fs from 'fs';
import * as path from 'path';
import MockPage from './MockPage';

export const metadata = { title: '見積書ワークベンチ（モック）' };

export default function MockRoute() {
  const templateHtml = fs.readFileSync(
    path.join(process.cwd(), 'lib/leaf/image-template.html'),
    'utf-8',
  );
  return <MockPage templateHtml={templateHtml} />;
}
