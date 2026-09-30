import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StorageNoticeComponent } from './shared/storage-notice.component';

@Component({
  selector: 'pp-root',
  standalone: true,
  imports: [RouterOutlet, StorageNoticeComponent],
  template: '<router-outlet /><pp-storage-notice />'
})
export class AppComponent {}
