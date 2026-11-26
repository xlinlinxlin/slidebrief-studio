import photos from './cover-photos.js';

const themeBySubject = Object.freeze({ operations: 'editorial', technology: 'midnight', finance: 'sage', general: 'editorial' });
const photoIds = Object.freeze({ operations: '3184360', technology: '546819', finance: '3184292' });

export function recommendVisualStyle(brief, subjectHint) {
  const topic = brief?.topic ?? brief?.title ?? '';
  let subject = Object.hasOwn(themeBySubject, subjectHint) ? subjectHint : 'general';
  if (subject === 'general') {
    if (/采购|预算|财务|利润|报价|成本|投资|finance|budget|procurement|pricing/iu.test(topic)) subject = 'finance';
    else if (/故障|异常|接口|架构|数据中心|系统|技术|软件|incident|outage|software|infrastructure/iu.test(topic)) subject = 'technology';
    else if (/客服|运营|试点|项目|培训|交付|服务|operations|service|pilot|rollout|project/iu.test(topic)) subject = 'operations';
  }
  return { visualSubject: subject, visualTheme: themeBySubject[subject] };
}

export function resolveCoverImage(subject) {
  return photos[Object.hasOwn(photos, subject) ? subject : 'operations'];
}

export function coverImageCredit(subject) {
  const id = photoIds[Object.hasOwn(photoIds, subject) ? subject : 'operations'];
  return `Cover illustration: Pexels, https://www.pexels.com/photo/${id}/`;
}
