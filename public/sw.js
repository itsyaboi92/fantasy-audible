self.addEventListener('push',event=>{let data={};try{data=event.data?.json()||{};}catch{}
  event.waitUntil(self.registration.showNotification(data.title||'Fantasy Audible',{body:data.body||'Injury alert',icon:'/favicon.ico',data:{url:data.url||'/?tab=Notifications'},tag:'fantasy-audible-injury-'+(data.title||'alert')}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=new URL(event.notification.data?.url||'/?tab=Notifications',self.location.origin);
  if(target.origin!==self.location.origin)return;event.waitUntil(clients.openWindow(target.href));});
